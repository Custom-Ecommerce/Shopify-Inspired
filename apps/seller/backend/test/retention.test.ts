import { test, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { ContactMessage, MobileDevice, NotificationOutbox, Product, StockMovement, SupportTicket, SyncOutbox } from '@/lib/services';
import { NEVER_PURGED, PURGEABLE_TARGETS, RETENTION_BATCH, RETENTION_DAYS, cutoffFor } from '../src/lib/retention-policy';
import { retentionSteps, runRetention } from '../src/lib/retention-purge';

// Sprint 6 EP-29 (S6-B7, CO-25): the retention purge on fake rows with fake dates. Dry run by default, a capped batch, idempotent, nothing inside the
// window touched, and the ledger, the audit log and subscription payments are not in it.

const NOW = new Date('2026-11-20T10:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const CRON = 'c'.repeat(32);
const MOD = 'm'.repeat(40);

type Row = Record<string, any>;
let stores: Record<string, Row[]>;
let audits: any[];
let restore: () => void = () => {};
let runPOST: (r: NextRequest) => Promise<Response>;
let adminPOST: (r: NextRequest) => Promise<Response>;

const matches = (row: Row, filter: Row): boolean =>
  Object.entries(filter).every(([k, v]: [string, any]) => {
    if (k === '_id' && v?.$in) return v.$in.includes(row._id);
    if (v && typeof v === 'object' && '$lt' in v) return row[k] instanceof Date && row[k] < v.$lt;
    return row[k] === v;
  });

function fake(name: string) {
  return {
    countDocuments: async (f: Row) => stores[name]!.filter((r) => matches(r, f)).length,
    find: (f: Row) => {
      let list = stores[name]!.filter((r) => matches(r, f));
      const q: any = { select: () => q, sort: () => q, limit: (n: number) => ((list = list.slice(0, n)), q), lean: async () => list.map((r) => ({ _id: r._id })) };
      return q;
    },
    deleteMany: async (f: Row) => {
      const before = stores[name]!.length;
      stores[name] = stores[name]!.filter((r) => !matches(r, f));
      return { deletedCount: before - stores[name]!.length };
    },
  };
}

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  runPOST = (await import('../src/app/api/internal/retention/run/route')).POST;
  adminPOST = (await import('../src/app/api/internal/retention/admin/route')).POST;
});

beforeEach(() => {
  process.env.RETENTION_CRON_SECRET = CRON;
  process.env.MODERATION_API_SECRET = MOD;
  const mk = (n: number, make: (i: number) => Row) => Array.from({ length: n }, (_, i) => make(i));
  stores = {
    notif: [
      ...mk(3, (i) => ({ _id: 'n-old-' + i, status: 'sent', sentAt: ago(91 + i) })),
      { _id: 'n-edge', status: 'sent', sentAt: ago(90) },
      { _id: 'n-new', status: 'sent', sentAt: ago(10) },
      { _id: 'n-failed-old', status: 'failed', sentAt: null },
      { _id: 'n-queued-old', status: 'queued', sentAt: null },
    ],
    sync: [{ _id: 's-old', status: 'sent', sentAt: ago(31) }, { _id: 's-new', status: 'sent', sentAt: ago(29) }, { _id: 's-dead', status: 'dead', sentAt: null }, { _id: 's-pending', status: 'pending', sentAt: null }],
    stock: [{ _id: 'm-old', changedAt: ago(366) }, { _id: 'm-edge', changedAt: ago(365) }, { _id: 'm-new', changedAt: ago(3) }],
    contact: [],
    tickets: [],
    phones: [],
  };
  audits = [];
  const saved = {
    connect: (mongoose as any).connect,
    n: Object.fromEntries(['countDocuments', 'find', 'deleteMany'].map((k) => [k, (NotificationOutbox as any)[k]])),
    s: Object.fromEntries(['countDocuments', 'find', 'deleteMany'].map((k) => [k, (SyncOutbox as any)[k]])),
    m: Object.fromEntries(['countDocuments', 'find', 'deleteMany'].map((k) => [k, (StockMovement as any)[k]])),
    c: Object.fromEntries(['countDocuments', 'find', 'deleteMany'].map((k) => [k, (ContactMessage as any)[k]])),
    t: Object.fromEntries(['countDocuments', 'find', 'deleteMany'].map((k) => [k, (SupportTicket as any)[k]])),
    d: Object.fromEntries(['countDocuments', 'find', 'deleteMany'].map((k) => [k, (MobileDevice as any)[k]])),
    pcount: (Product as any).countDocuments,
    audit: retentionSteps.audit,
  };
  (mongoose as any).connect = async () => mongoose;
  Object.assign(NotificationOutbox as any, fake('notif'));
  Object.assign(SyncOutbox as any, fake('sync'));
  Object.assign(StockMovement as any, fake('stock'));
  Object.assign(ContactMessage as any, fake('contact'));
  Object.assign(SupportTicket as any, fake('tickets'));
  Object.assign(MobileDevice as any, fake('phones'));
  (Product as any).countDocuments = async () => 0;
  retentionSteps.audit = (async (...a: any[]) => audits.push(a)) as any;
  restore = () => {
    (mongoose as any).connect = saved.connect;
    Object.assign(NotificationOutbox as any, saved.n);
    Object.assign(SyncOutbox as any, saved.s);
    Object.assign(StockMovement as any, saved.m);
    Object.assign(ContactMessage as any, saved.c);
    Object.assign(SupportTicket as any, saved.t);
    Object.assign(MobileDevice as any, saved.d);
    (Product as any).countDocuments = saved.pcount;
    retentionSteps.audit = saved.audit;
    delete process.env.RETENTION_CRON_SECRET;
    delete process.env.MODERATION_API_SECRET;
  };
});
afterEach(() => restore());

const ids = (name: string) => stores[name]!.map((r) => r._id);

test('the periods are in ONE place: 90 / 30 / 365 / 365 days, and the Sprint 7 periods are fixed now', () => {
  assert.deepEqual(RETENTION_DAYS, { notificationOutboxSent: 90, syncOutboxSent: 30, stockMovements: 365, productTrash: 365, closedTickets: 730, contactMessages: 365, revokedMobileDevices: 90 });
  assert.equal(cutoffFor(NOW, 90).toISOString(), '2026-08-22T10:00:00.000Z');
});

test('GUARD: the ledger, the audit log and subscription payments are NOT purgeable, and the purge code never references them', () => {
  assert.deepEqual([...PURGEABLE_TARGETS], ['notification_outbox', 'sync_outbox', 'stock_movements', 'product_trash', 'contact_messages', 'closed_tickets', 'mobile_devices']);
  for (const never of NEVER_PURGED) assert.equal((PURGEABLE_TARGETS as readonly string[]).includes(never), false, never);
  const forbidden = /CommissionEntry|commission-entry|commissionEntries|SubscriptionPayment|subscriptionPayments|subscription-payment|\bAuditLog\b|audit-log|commissionLedger|CommissionLedger/;
  for (const file of ['src/lib/retention-purge.ts', 'src/lib/retention-policy.ts', 'src/app/api/internal/retention/run/route.ts', 'src/app/api/internal/retention/admin/route.ts']) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const code = file.endsWith('policy.ts') ? source.replace(/NEVER_PURGED[\s\S]*?\] as const;/, '') : source;
    assert.equal(forbidden.test(code), false, file + ' references a collection that is never purged');
  }
});

test('a DRY RUN counts what is past its period and removes nothing', async () => {
  const run = await runRetention({ apply: false, now: NOW, actorId: 'system:retention' });
  assert.equal(run.dryRun, true);
  assert.deepEqual(run.targets.map((t) => [t.key, t.eligible, t.purged]), [['notification_outbox', 3, 0], ['sync_outbox', 1, 0], ['stock_movements', 1, 0], ['product_trash', 0, 0], ['contact_messages', 0, 0], ['closed_tickets', 0, 0], ['mobile_devices', 0, 0]]);
  assert.equal(stores.notif!.length, 7);
});

test('apply removes only rows PAST the period: a row exactly at the boundary, a newer row, a failed, a queued, a dead and a pending row all stay', async () => {
  const run = await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  assert.deepEqual(run.targets.map((t) => t.purged), [3, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(ids('notif'), ['n-edge', 'n-new', 'n-failed-old', 'n-queued-old']);
  assert.deepEqual(ids('sync'), ['s-new', 's-dead', 's-pending']);
  assert.deepEqual(ids('stock'), ['m-edge', 'm-new']);
});

test('a second run finds nothing: idempotent', async () => {
  await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  const again = await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  assert.deepEqual(again.targets.map((t) => [t.eligible, t.purged, t.more]), [[0, 0, false], [0, 0, false], [0, 0, false], [0, 0, false], [0, 0, false], [0, 0, false], [0, 0, false]]);
  assert.equal(ids('notif').length, 4);
});

test('a run never removes more than the batch per target, and says there is more', async () => {
  stores.notif = Array.from({ length: RETENTION_BATCH + 25 }, (_, i) => ({ _id: 'x' + i, status: 'sent', sentAt: ago(200) }));
  const run = await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  const notif = run.targets[0]!;
  assert.deepEqual([notif.eligible, notif.purged, notif.more], [RETENTION_BATCH + 25, RETENTION_BATCH, true]);
  assert.equal(stores.notif.length, 25);
  const dry = await runRetention({ apply: false, now: NOW, actorId: 'system:retention' });
  assert.equal(dry.targets[0]!.more, false, '25 left fits one batch');
});

test('the fake date decides: the same rows a year earlier are all inside the window', async () => {
  const early = new Date(NOW.getTime() - 400 * DAY);
  const run = await runRetention({ apply: true, now: early, actorId: 'system:retention' });
  assert.deepEqual(run.targets.map((t) => t.purged), [0, 0, 0, 0, 0, 0, 0]);
});

test('one audit line per run, with the counts and who ran it', async () => {
  await runRetention({ apply: true, now: NOW, actorId: 'admin:65a000000000000000000001' });
  assert.equal(audits.length, 1);
  const [action, entity, , actor, details] = audits[0];
  assert.deepEqual([action, entity, actor, details.apply], ['retention.run', 'retention', 'admin:65a000000000000000000001', true]);
  assert.deepEqual(details.targets.map((t: any) => [t.key, t.eligible, t.purged]), [['notification_outbox', 3, 3], ['sync_outbox', 1, 1], ['stock_movements', 1, 1], ['product_trash', 0, 0], ['contact_messages', 0, 0], ['closed_tickets', 0, 0], ['mobile_devices', 0, 0]]);
  await runRetention({ apply: false, now: NOW, actorId: 'system:retention' });
  assert.equal(audits.length, 2, 'a dry run is audited too');
});

const cron = (body?: unknown, secret: string | null = CRON) =>
  new NextRequest('http://seller.test/api/internal/retention/run', { method: 'POST', headers: { ...(secret === null ? {} : { 'x-retention-secret': secret }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });

test('the cron route: closed without or with a wrong secret, and when none is set; a dry run by default; only { apply: true } purges', async (t) => {
  // The route reads the real clock; the test data are dated relative to NOW, so the clock is frozen at NOW.
  mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  t.after(() => mock.timers.reset());
  assert.equal((await runPOST(cron({ apply: true }, null))).status, 401);
  assert.equal((await runPOST(cron({ apply: true }, 'w'.repeat(32)))).status, 401);
  assert.equal(stores.notif!.length, 7);
  for (const body of [undefined, {}, { apply: false }]) {
    const res = await runPOST(cron(body));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { dryRun: boolean }).dryRun, true);
  }
  assert.equal(stores.notif!.length, 7);
  const applied = await runPOST(cron({ apply: true }));
  assert.equal(((await applied.json()) as { dryRun: boolean }).dryRun, false);
  assert.equal(stores.notif!.length, 4);
  for (const bad of [{ apply: 'yes' }, { apply: true, force: true }, [true], 'not json']) assert.equal((await runPOST(cron(bad))).status, 400, JSON.stringify(bad));
  delete process.env.RETENTION_CRON_SECRET;
  assert.equal((await runPOST(cron({ apply: true }))).status, 503);
});

test('the admin route is signed: unsigned and wrongly signed calls are refused; a signed dry run counts and the audit names the admin', async (t) => {
  // The route reads the real clock; the test data are dated relative to NOW, so the clock is frozen at NOW.
  mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  t.after(() => mock.timers.reset());
  const path = '/api/internal/retention/admin';
  const signed = (body: unknown, secret = MOD) => {
    const raw = JSON.stringify(body);
    return new NextRequest('http://seller.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...internalRequestHeaders(secret, { method: 'POST', path, adminId: 'admin-7', body: raw }) }, body: raw });
  };
  assert.equal((await adminPOST(new NextRequest('http://seller.test' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 401);
  assert.equal((await adminPOST(signed({}, 'w'.repeat(40)))).status, 401);
  const res = await adminPOST(signed({}));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { dryRun: boolean }).dryRun, true);
  assert.equal(audits[0][3], 'admin:admin-7');
  assert.equal(stores.notif!.length, 7);
  assert.equal((await adminPOST(signed({ apply: 'yes' }))).status, 422);
  assert.equal((await adminPOST(signed({ apply: true }))).status, 200);
  assert.equal(stores.notif!.length, 4);
});

// Sprint 7 (S7-B4): the contact messages (365 days) and the tickets (730 days). ONLY closed rows, counted from their last change.
test('Sprint 7: closed contact messages and closed tickets are purged past their period; open, answered, new, read and replied rows never are', async () => {
  stores.contact = [
    { _id: 'c-old-closed', status: 'closed', updatedAt: ago(366) },
    { _id: 'c-edge', status: 'closed', updatedAt: ago(365) },
    { _id: 'c-new-closed', status: 'closed', updatedAt: ago(30) },
    { _id: 'c-old-new', status: 'new', updatedAt: ago(900) },
    { _id: 'c-old-read', status: 'read', updatedAt: ago(900) },
    { _id: 'c-old-replied', status: 'replied', updatedAt: ago(900) },
  ];
  stores.tickets = [
    { _id: 't-old-closed', status: 'closed', updatedAt: ago(731) },
    { _id: 't-366', status: 'closed', updatedAt: ago(400) },
    { _id: 't-old-open', status: 'open', updatedAt: ago(1000) },
    { _id: 't-old-answered', status: 'answered', updatedAt: ago(1000) },
  ];
  const dry = await runRetention({ apply: false, now: NOW, actorId: 'system:retention' });
  assert.deepEqual(dry.targets.filter((t) => ['contact_messages', 'closed_tickets'].includes(t.key)).map((t) => [t.key, t.days, t.eligible, t.purged]), [['contact_messages', 365, 1, 0], ['closed_tickets', 730, 1, 0]]);
  assert.equal(stores.contact!.length, 6);
  assert.equal(stores.tickets!.length, 4, 'a dry run removes nothing');
  const run = await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  assert.deepEqual(run.targets.filter((t) => ['contact_messages', 'closed_tickets'].includes(t.key)).map((t) => t.purged), [1, 1]);
  assert.deepEqual(ids('contact'), ['c-edge', 'c-new-closed', 'c-old-new', 'c-old-read', 'c-old-replied']);
  assert.deepEqual(ids('tickets'), ['t-366', 't-old-open', 't-old-answered']);
  const again = await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  assert.deepEqual(again.targets.filter((t) => ['contact_messages', 'closed_tickets'].includes(t.key)).map((t) => [t.eligible, t.purged]), [[0, 0], [0, 0]], 'idempotent');
});

test('Sprint 7: the support purge is capped at one batch per run and says there is more', async () => {
  stores.contact = Array.from({ length: RETENTION_BATCH + 5 }, (_, i) => ({ _id: 'c-' + String(i).padStart(4, '0'), status: 'closed', updatedAt: ago(400) }));
  const run = await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  const contact = run.targets.find((t) => t.key === 'contact_messages')!;
  assert.equal(contact.purged, RETENTION_BATCH);
  assert.equal(contact.more, true);
  assert.equal(stores.contact!.length, 5);
});

test('Sprint 9 (EP-31.US01.T09): signed-out phones are purged 90 days after they were revoked; a signed-in phone never is, and a dry run removes nothing', async () => {
  // The fake matcher knows $lt on a Date and refuses a null, as $type 'date' does.
  stores.phones = [
    { _id: 'p-old', revokedAt: ago(91) },
    { _id: 'p-edge', revokedAt: ago(90) },
    { _id: 'p-new', revokedAt: ago(5) },
    { _id: 'p-live', revokedAt: null },
  ];
  const dry = await runRetention({ apply: false, now: NOW, actorId: 'system:retention' });
  assert.deepEqual(dry.targets.filter((t) => t.key === 'mobile_devices').map((t) => [t.days, t.eligible, t.purged]), [[90, 1, 0]]);
  assert.equal(stores.phones.length, 4);
  const run = await runRetention({ apply: true, now: NOW, actorId: 'system:retention' });
  assert.deepEqual(run.targets.filter((t) => t.key === 'mobile_devices').map((t) => t.purged), [1]);
  assert.deepEqual(ids('phones'), ['p-edge', 'p-new', 'p-live']);
});
