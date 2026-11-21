import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { signHmacHeaders } from './_sync-sign';
import { User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { compareHeads, digest, receiveBatch, repair, type OutboxPort, type RevisionPort } from '../src/lib/sync-receiver';
import { RETRY_LIMIT, errorCode, listFailedEmails, maskRecipient, retryDeadEvents, retryFailedEmails, retrySteps } from '../src/lib/admin-retries';
import { retentionSteps } from '../src/app/api/admin/retention/route';

// Sprint 6 EP-16 (S6-B7, D-106): the reduced sync (record, compare, repair), the audited retries and the admin's retention run. Fakes only.

const NOW = new Date('2026-11-20T10:00:00.000Z');
const STORE = '65a000000000000000000011';
const SECRET = 'x'.repeat(40);
const ADMIN = '65a000000000000000000001';

function fakeRevisions(): RevisionPort & { rows: Map<string, number>; writes: number } {
  const rows = new Map<string, number>();
  const port = {
    rows,
    writes: 0,
    async load(store: string, group: string) { return rows.get(store + '|' + group) ?? null; },
    async raise(store: string, group: string, revision: number) { port.writes += 1; rows.set(store + '|' + group, Math.max(rows.get(store + '|' + group) ?? 0, revision)); },
  };
  return port;
}

/** A sender outbox of revisions 1..10 for one store: 1-4 sent, 5-6 dead, 7 pending, 8-10 sent. */
function fakeOutbox(): OutboxPort & { rows: Array<{ revision: number; status: string; attempts: number }> } {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((revision) => ({ revision, status: revision <= 4 || revision >= 8 ? 'sent' : revision <= 6 ? 'dead' : 'pending', attempts: 3 }));
  return {
    rows,
    async requeueRange(_store, _group, from, to) {
      const inRange = rows.filter((r) => r.revision >= from && r.revision <= to);
      let requeued = 0;
      for (const r of inRange) if (r.status === 'sent' || r.status === 'dead') { r.status = 'pending'; r.attempts = 0; requeued += 1; }
      return { found: inRange.length, requeued, alreadyPending: inRange.filter((r) => r.status === 'pending').length - requeued };
    },
  };
}

test('receive records the highest acknowledged revision per (store, group) idempotently; a repeat or an older batch changes nothing', async () => {
  const revisions = fakeRevisions();
  const batch = { store: STORE, toRevision: 7, events: [{ group: 'storefront', revision: 5 }, { group: 'storefront', revision: 7 }, { group: 'governance', revision: 2 }] };
  const first = await receiveBatch(batch, NOW, revisions);
  assert.deepEqual(first!.groups, [{ group: 'storefront', revision: 7, stale: false }, { group: 'governance', revision: 2, stale: false }]);
  assert.deepEqual([first!.accepted, first!.acknowledgedRevision, first!.store], [3, 7, STORE]);
  assert.equal(revisions.writes, 2);
  const again = await receiveBatch(batch, NOW, revisions);
  assert.deepEqual(again!.groups.map((g) => g.stale), [true, true]);
  assert.equal(revisions.writes, 2, 'a stale revision writes nothing (isStaleRevision)');
  const older = await receiveBatch({ store: STORE, toRevision: 3, events: [{ group: 'storefront', revision: 3 }] }, NOW, revisions);
  assert.equal(older!.groups[0]!.stale, true);
  assert.equal(revisions.rows.get(STORE + '|storefront'), 7);
  const newer = await receiveBatch({ store: STORE, toRevision: 9, events: [{ group: 'storefront', revision: 9 }] }, NOW, revisions);
  assert.equal(newer!.groups[0]!.stale, false);
  assert.equal(revisions.rows.get(STORE + '|storefront'), 9);
});

test('receive applies NO data: it only touches the revision port; an empty batch records toRevision under the default group; a bad shape is null (422)', async () => {
  const revisions = fakeRevisions();
  const empty = await receiveBatch({ store: STORE, toRevision: 4, events: [] }, NOW, revisions);
  assert.deepEqual(empty!.groups, [{ group: 'default', revision: 4, stale: false }]);
  for (const bad of [null, [], { store: 5, toRevision: 1, events: [] }, { store: STORE, toRevision: -1, events: [] }, { store: STORE, toRevision: 1.5, events: [] }, { store: STORE, toRevision: 1 }, { store: '', toRevision: 1, events: [] }]) {
    assert.equal(await receiveBatch(bad, NOW, revisions), null, JSON.stringify(bad));
  }
});

test('digest: ok, behind (the gap) or ahead (the gap) against the acknowledged revision', async () => {
  const revisions = fakeRevisions();
  await receiveBatch({ store: STORE, toRevision: 7, events: [{ group: 'storefront', revision: 7 }] }, NOW, revisions);
  assert.deepEqual((await digest({ store: STORE, group: 'storefront', headRevision: 7 }, NOW, revisions)) && compareHeads(7, 7), { status: 'ok', gap: 0 });
  const behind = await digest({ store: STORE, group: 'storefront', headRevision: 12 }, NOW, revisions);
  assert.deepEqual([behind!.status, behind!.gap, behind!.acknowledgedRevision], ['behind', 5, 7]);
  const ahead = await digest({ store: STORE, group: 'storefront', headRevision: 4 }, NOW, revisions);
  assert.deepEqual([ahead!.status, ahead!.gap], ['ahead', 3]);
  const none = await digest({ store: STORE, headRevision: 3 }, NOW, revisions);
  assert.deepEqual([none!.group, none!.acknowledgedRevision, none!.status, none!.gap], ['default', null, 'behind', 3]);
  assert.equal((await digest({ store: STORE, headRevision: 0 }, NOW, revisions))!.status, 'ok', 'nothing sent, nothing to ack');
  assert.equal(await digest({ store: STORE }, NOW, revisions), null);
});

test('repair requeues the missing range in the sender outbox, never replays what is acknowledged, and is idempotent', async () => {
  const revisions = fakeRevisions();
  const outbox = fakeOutbox();
  await receiveBatch({ store: STORE, toRevision: 4, events: [{ group: 'default', revision: 4 }] }, NOW, revisions);
  const first = await repair({ store: STORE, fromRevision: 1, toRevision: 10 }, NOW, { revisions, outbox });
  assert.equal(first.ok, true);
  const body = (first as { ok: true; body: Record<string, any> }).body;
  assert.deepEqual([body.replayFrom, body.requeued, body.alreadyPending, body.missing, body.acknowledgedRevision], [5, 5, 1, 0, 4]);
  assert.deepEqual(outbox.rows.filter((r) => r.revision <= 4).map((r) => r.status), ['sent', 'sent', 'sent', 'sent'], 'acknowledged revisions are never replayed');
  assert.deepEqual(outbox.rows.filter((r) => r.revision >= 5).map((r) => [r.status, r.attempts]), Array(6).fill(['pending', 0]));
  const second = (await repair({ store: STORE, fromRevision: 1, toRevision: 10 }, NOW, { revisions, outbox })) as { ok: true; body: Record<string, any> };
  assert.equal(second.body.requeued, 0, 'a repeat requeues nothing new');
  const acked = (await repair({ store: STORE, fromRevision: 1, toRevision: 3 }, NOW, { revisions, outbox })) as { ok: true; body: Record<string, any> };
  assert.deepEqual([acked.body.requeued, acked.body.replayFrom], [0, null]);
});

test('repair reports a gap that has no outbox rows as missing, and refuses a bad or over-long range', async () => {
  const revisions = fakeRevisions();
  const outbox = fakeOutbox();
  const gap = (await repair({ store: STORE, fromRevision: 8, toRevision: 14 }, NOW, { revisions, outbox })) as { ok: true; body: Record<string, any> };
  assert.equal(gap.body.missing, 4);
  for (const bad of [{ store: STORE, fromRevision: 5, toRevision: 2 }, { store: STORE, fromRevision: 1, toRevision: 5000 }, { store: STORE, fromRevision: 'a', toRevision: 2 }, null]) {
    assert.equal((await repair(bad, NOW, { revisions, outbox })).ok, false, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------------------------------------------- the signed routes

async function signedRoute(name: string, body: unknown, secret = SECRET): Promise<Response> {
  process.env.SYNC_HMAC_SECRET = secret;
  const raw = JSON.stringify(body);
  const handler = ((await import('../src/app/api/internal/sync/' + name + '/route')) as any).POST as (r: Request) => Promise<Response>;
  return handler(new Request('http://admin.test/api/internal/sync/' + name, { method: 'POST', headers: { 'content-type': 'application/json', ...(await signHmacHeaders(raw, SECRET)) }, body: raw }));
}

test('the sync routes keep the HMAC check: an unsigned or wrongly signed call is 401 before anything is read', async () => {
  process.env.SYNC_HMAC_SECRET = SECRET;
  for (const name of ['receive', 'digest', 'repair']) {
    const handler = ((await import('../src/app/api/internal/sync/' + name + '/route')) as any).POST as (r: Request) => Promise<Response>;
    assert.equal((await handler(new Request('http://admin.test/x', { method: 'POST', body: '{}' }))).status, 401, name);
    const raw = '{}';
    const wrong = await handler(new Request('http://admin.test/x', { method: 'POST', headers: await signHmacHeaders(raw, 'y'.repeat(40)), body: raw }));
    assert.equal(wrong.status, 401, name + ' wrong secret');
  }
});

// ----------------------------------------------------------------------------------------------------------------------- retries

let audits: any[];
let moved: Record<string, string>;
const saved: Record<string, any> = {};
beforeEach(() => {
  audits = [];
  moved = {};
  Object.assign(saved, retrySteps);
  retrySteps.audit = (async (...a: any[]) => audits.push(a)) as any;
  // compare-and-set on the status that was shown: dead (sync) / failed (email); ids starting with "gone" were already moved by someone else
  retrySteps.retrySync = async (id) => (id.startsWith('65a000000000000000000bad') ? false : ((moved[id] = 'pending'), true));
  retrySteps.retryEmail = async (id) => (id.startsWith('65a000000000000000000bad') ? false : ((moved[id] = 'queued'), true));
});
afterEach(() => Object.assign(retrySteps, saved));

const id = (n: number) => '65a0000000000000000000' + String(n).padStart(2, '0');

test('retrying dead events: each is one compare-and-set, a row already moved is skipped, one audit entry per call with the ids', async () => {
  const out = await retryDeadEvents(ADMIN, [id(1), id(2), '65a000000000000000000bad1'], NOW);
  assert.deepEqual(out, { requested: 3, retried: 2, skipped: 1 });
  assert.deepEqual(moved, { [id(1)]: 'pending', [id(2)]: 'pending' });
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0][0], audits[0][3], audits[0][4].retried, audits[0][4].ids.length], ['sync.retry', ADMIN, 2, 3]);
});

test('bulk retry is capped at 100 and de-duplicated; the same for failed emails', async () => {
  const many = Array.from({ length: 150 }, (_, i) => '65a00000000000000' + String(i).padStart(7, '0'));
  const out = await retryDeadEvents(ADMIN, [...many, many[0]!], NOW);
  assert.deepEqual([out.requested, RETRY_LIMIT], [100, 100]);
  const mail = await retryFailedEmails(ADMIN, [id(5), id(5)], NOW);
  assert.deepEqual(mail, { requested: 1, retried: 1, skipped: 0 });
  assert.equal(moved[id(5)], 'queued');
  assert.equal(audits.at(-1)[0], 'notification.retry');
});

test('a failed audit write does not undo a retry', async () => {
  retrySteps.audit = (async () => { throw new Error('audit down'); }) as any;
  const quiet = console.error;
  console.error = () => {};
  try { assert.equal((await retryDeadEvents(ADMIN, [id(1)], NOW)).retried, 1); } finally { console.error = quiet; }
});

test('the failed-email list NEVER carries the payload or the body: kind, masked recipient, attempts, an error CODE and dates only', async () => {
  retrySteps.listFailed = async () => [{ _id: id(9), template: 'order_placed_customer', to: 'ayesha@example.com', attempts: 5, lastError: 'SMTP_TIMEOUT while sending to ayesha@example.com', payload: { phone: '0300' }, bodyText: 'secret body', bodyHtml: '<b>x</b>', createdAt: NOW, updatedAt: NOW }];
  retrySteps.countFailed = async () => 1;
  const list = await listFailedEmails();
  assert.deepEqual(Object.keys(list.docs[0]!).sort(), ['attempts', 'createdAt', 'errorCode', 'id', 'kind', 'recipient', 'updatedAt']);
  assert.equal(list.docs[0]!.recipient, 'a***@e***.com');
  assert.equal(list.docs[0]!.errorCode, 'SMTP_TIMEOUT');
  const text = JSON.stringify(list);
  for (const leak of ['ayesha', '0300', 'secret body', '<b>', 'example']) assert.equal(text.includes(leak), false, leak);
  assert.equal(maskRecipient('no-at-sign'), '***');
  assert.equal(errorCode('  <script>x</script> boom'), 'scriptxscript');
  assert.equal(errorCode(null), null);
});

// ------------------------------------------------------------------------------------------------------ routes: capability, retention

const UserModel = User as any;
let level = 'owner';
let restoreDb: () => void = () => {};
before(() => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
});
beforeEach(() => {
  level = 'owner';
  const s = { connect: (mongoose as any).connect, findById: UserModel.findById, run: retentionSteps.run };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin', adminLevel: level, accountStatus: 'active', tokenVersion: 0 }) }) });
  restoreDb = () => { (mongoose as any).connect = s.connect; UserModel.findById = s.findById; retentionSteps.run = s.run; };
});
afterEach(() => restoreDb());

const authed = async (url: string, body?: unknown) =>
  new Request('http://admin.test' + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await signSession({ sub: ADMIN, role: 'admin' }, SECRET, ADMIN_AUDIENCE)) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test('sync.manage: owner and operations may retry and list failed emails; finance and support get 403 and nothing moves', async () => {
  const retryPOST = (await import('../src/app/api/admin/sync/retry/route')).POST;
  const failedGET = (await import('../src/app/api/admin/notifications/failed/route')).GET;
  const mailPOST = (await import('../src/app/api/admin/notifications/retry/route')).POST;
  retrySteps.listFailed = async () => [];
  retrySteps.countFailed = async () => 0;
  for (const l of ['finance', 'customer_support']) {
    level = l;
    assert.equal((await retryPOST(await authed('/x', { ids: [id(1)] }))).status, 403, l);
    assert.equal((await failedGET(await authed('/x'))).status, 403, l);
    assert.equal((await mailPOST(await authed('/x', { ids: [id(1)] }))).status, 403, l);
  }
  assert.deepEqual(moved, {});
  for (const l of ['owner', 'operations']) {
    level = l;
    assert.equal((await retryPOST(await authed('/x', { ids: [id(1)] }))).status, 200, l);
    assert.equal((await failedGET(await authed('/x'))).status, 200, l);
  }
});

test('the retry body: 1 to 100 distinct ObjectIds, nothing else (400 naming the field)', async () => {
  const retryPOST = (await import('../src/app/api/admin/sync/retry/route')).POST;
  const bodies: Array<[unknown, string]> = [
    [{}, 'ids'], [{ ids: [] }, 'ids'], [{ ids: ['nope'] }, 'ids.0'], [{ ids: [id(1), id(1)] }, 'ids'],
    [{ ids: Array.from({ length: 101 }, (_, i) => '65a00000000000000' + String(i).padStart(7, '0')) }, 'ids'], [{ ids: [id(1)], all: true }, 'all'],
  ];
  for (const [body, field] of bodies) {
    const res = await retryPOST(await authed('/x', body));
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(((await res.json()) as { field?: string }).field, field);
  }
  assert.deepEqual(moved, {});
});

test('retention (settings.write, owner only): a dry run by default, apply only with { apply: true }; other levels get 403 and nothing runs', async () => {
  const retentionPOST = (await import('../src/app/api/admin/retention/route')).POST;
  const calls: any[] = [];
  retentionSteps.run = (async (admin: string, input: any) => (calls.push([admin, input]), { dryRun: input.apply !== true, targets: [], at: NOW.toISOString() })) as any;
  for (const l of ['finance', 'operations', 'customer_support']) {
    level = l;
    assert.equal((await retentionPOST(await authed('/r', {}))).status, 403, l);
  }
  assert.equal(calls.length, 0);
  level = 'owner';
  assert.equal(((await (await retentionPOST(await authed('/r', {}))).json()) as { dryRun: boolean }).dryRun, true);
  assert.deepEqual(calls[0], [ADMIN, { apply: false }]);
  await retentionPOST(await authed('/r', { apply: true }));
  assert.deepEqual(calls[1], [ADMIN, { apply: true }]);
  assert.equal((await retentionPOST(await authed('/r', { apply: 'yes' }))).status, 400);
  assert.equal((await retentionPOST(await authed('/r', { apply: true, days: 1 }))).status, 400);
  assert.equal(calls.length, 2);
});
