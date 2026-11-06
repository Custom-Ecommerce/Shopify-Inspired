import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, PlatformSettingsModel, User, registerSyncOutboxModel, signSession } from '@/lib/workspace';
import * as authNs from '@markaz/auth';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { unwrapCjs } from '@/lib/cjs';
import {
  ADMIN_SETTINGS_FIELDS,
  ADMIN_SETTINGS_MAX_STORES_MAX,
  ADMIN_SETTINGS_NOTE_MAX,
  ADMIN_SETTINGS_RATE_MAX,
  ADMIN_SETTINGS_REASON_MAX,
} from '../../../../packages/contracts/src/admin-settings';
import {
  SETTINGS_FIELDS,
  SETTINGS_MAX_STORES_MAX,
  SETTINGS_NOTE_MAX,
  SETTINGS_RATE_MAX,
  SETTINGS_REASON_MAX,
  buildRevertUpdate,
  buildSettingsUpdate,
  changedFields,
  needsSync,
  parseSettingsUpdate,
  revisionFilter,
  settingsSnapshot,
  toSettingsRow,
} from '@/lib/admin-settings';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const SETTINGS_ID = '65a0000000000000000000e1';
const T1 = new Date('2026-10-01T09:00:00.000Z');
const T2 = new Date('2026-10-05T09:00:00.000Z');

const POLICY = (unwrapCjs(authNs) as any).POLICY_MATRIX as Record<string, any>;
const SettingsModel = PlatformSettingsModel as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;

let route: { GET: (r: Request) => Promise<Response>; PATCH: (r: Request) => Promise<Response> };

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  route = await import('../src/app/api/admin/settings/route');
});

const stored = {
  _id: SETTINGS_ID,
  globalType: 'platformSettings',
  defaultCommissionRate: 4,
  maxStoresPerSeller: 3,
  stripeCommissionNote: 'Stripe fees are separate.',
  settingsRevision: 2,
  createdAt: T1,
  updatedAt: T1,
};

interface World {
  found: unknown;
  /** What findOneAndUpdate answers; the string 'apply' builds it from the update. */
  updated: unknown;
  auditFails: boolean;
  outboxFails: boolean;
}

const calls = {
  finds: [] as any[],
  updates: [] as Array<{ filter: any; update: any }>,
  reverts: [] as Array<{ filter: any; update: any }>,
  audits: [] as any[],
  outbox: [] as any[],
};

function chain(value: unknown): any {
  const c: any = { select: () => c, sort: () => c, lean: () => c, exec: async () => value, then: (ok: any, bad: any) => Promise.resolve(value).then(ok, bad) };
  return c;
}

function applyUpdate(base: any, update: any): any {
  const next = { ...base, ...(update.$set ?? {}), updatedAt: T2 };
  for (const key of Object.keys(update.$unset ?? {})) delete next[key];
  next.settingsRevision = (typeof base.settingsRevision === 'number' ? base.settingsRevision : 0) + (update.$inc?.settingsRevision ?? 0);
  return next;
}

function install(world: Partial<World> = {}): () => void {
  const w: World = { found: stored, updated: 'apply', auditFails: false, outboxFails: false, ...world };
  const originals = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    findOne: SettingsModel.findOne,
    findOneAndUpdate: SettingsModel.findOneAndUpdate,
    updateOne: SettingsModel.updateOne,
    auditCreate: AuditModel.create,
  };
  for (const key of Object.keys(calls) as Array<keyof typeof calls>) (calls[key] as unknown[]).length = 0;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin' }) }) });
  SettingsModel.findOne = (filter: unknown) => (calls.finds.push(filter), chain(w.found));
  SettingsModel.findOneAndUpdate = (filter: any, update: any) => {
    calls.updates.push({ filter, update });
    return chain(w.updated === 'apply' ? applyUpdate(w.found, update) : w.updated);
  };
  SettingsModel.updateOne = async (filter: any, update: any) => (calls.reverts.push({ filter, update }), { matchedCount: 1 });
  AuditModel.create = async (doc: any) => {
    if (w.auditFails) throw new Error('audit down');
    calls.audits.push(doc);
    return { _id: '65a000000000000000000099' };
  };
  registerSyncOutboxModel({
    create: async (doc: any) => {
      if (w.outboxFails) throw new Error('outbox down');
      calls.outbox.push(doc);
      return doc;
    },
    find: () => chain([]),
    findOne: () => chain(null),
    updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: async () => ({ matchedCount: 0, modifiedCount: 0 }),
  } as any);
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    SettingsModel.findOne = originals.findOne;
    SettingsModel.findOneAndUpdate = originals.findOneAndUpdate;
    SettingsModel.updateOne = originals.updateOne;
    AuditModel.create = originals.auditCreate;
  };
}

async function token(role = 'admin', audience = ADMIN_AUDIENCE): Promise<string> {
  return signSession({ sub: ADMIN_ID, role }, SECRET, audience);
}

async function send(method: string, body?: unknown, bearer?: string | null): Promise<Request> {
  const value = bearer === undefined ? await token() : bearer;
  return new Request('http://admin.test/api/admin/settings', {
    method,
    headers: { ...(value ? { authorization: 'Bearer ' + value } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('the backend limits and the writable fields are the contract ones', () => {
  assert.deepEqual([...SETTINGS_FIELDS], [...ADMIN_SETTINGS_FIELDS]);
  assert.equal(SETTINGS_RATE_MAX, ADMIN_SETTINGS_RATE_MAX);
  assert.equal(SETTINGS_MAX_STORES_MAX, ADMIN_SETTINGS_MAX_STORES_MAX);
  assert.equal(SETTINGS_NOTE_MAX, ADMIN_SETTINGS_NOTE_MAX);
  assert.equal(SETTINGS_REASON_MAX, ADMIN_SETTINGS_REASON_MAX);
});

test('parseSettingsUpdate reads the settings sent, trims text, and clears a blank note', () => {
  assert.deepEqual(parseSettingsUpdate({ defaultCommissionRate: 5 }), { ok: true, data: { changes: { defaultCommissionRate: 5 }, reason: null } });
  assert.deepEqual(parseSettingsUpdate({ defaultCommissionRate: 0 }), { ok: true, data: { changes: { defaultCommissionRate: 0 }, reason: null } });
  assert.deepEqual(parseSettingsUpdate({ defaultCommissionRate: 12.5, maxStoresPerSeller: 10, stripeCommissionNote: '  hi  ', reason: ' Q4 pricing ' }), {
    ok: true,
    data: { changes: { defaultCommissionRate: 12.5, maxStoresPerSeller: 10, stripeCommissionNote: 'hi' }, reason: 'Q4 pricing' },
  });
  assert.deepEqual(parseSettingsUpdate({ stripeCommissionNote: '   ' }), { ok: true, data: { changes: { stripeCommissionNote: null }, reason: null } });
  assert.deepEqual(parseSettingsUpdate({ stripeCommissionNote: null }), { ok: true, data: { changes: { stripeCommissionNote: null }, reason: null } });
});

test('parseSettingsUpdate refuses bad values, unknown fields, and an empty change, naming each field', () => {
  const bad: unknown[] = [
    null,
    [],
    'text',
    {},
    { reason: 'because' },
    { defaultCommissionRate: -1 },
    { defaultCommissionRate: 100.01 },
    { defaultCommissionRate: '5' },
    { defaultCommissionRate: null },
    { defaultCommissionRate: Number.NaN },
    { maxStoresPerSeller: 0 },
    { maxStoresPerSeller: 1001 },
    { maxStoresPerSeller: 2.5 },
    { maxStoresPerSeller: '3' },
    { stripeCommissionNote: 7 },
    { stripeCommissionNote: 'x'.repeat(501) },
    { defaultCommissionRate: 5, reason: '' },
    { defaultCommissionRate: 5, reason: 5 },
    { defaultCommissionRate: 5, reason: 'x'.repeat(501) },
    { defaultCommissionRate: 5, settingsRevision: 9 },
    { defaultCommissionRate: 5, updatedAt: 'x' },
    { defaultCommissionRate: 5, globalType: 'other' },
  ];
  for (const body of bad) assert.equal(parseSettingsUpdate(body).ok, false, JSON.stringify(body));
  const revision = parseSettingsUpdate({ defaultCommissionRate: 5, settingsRevision: 9 });
  assert.deepEqual(revision.ok ? [] : revision.issues, [{ path: 'settingsRevision', message: 'is not a platform setting' }]);
  const empty = parseSettingsUpdate({});
  assert.deepEqual(empty.ok ? [] : empty.issues, [{ path: 'body', message: 'change at least one setting' }]);
  assert.equal(parseSettingsUpdate({ defaultCommissionRate: 100, maxStoresPerSeller: 1000 }).ok, true);
});

test('toSettingsRow uses the model defaults for what is missing, and ISO dates', () => {
  const row = toSettingsRow(stored);
  assert.deepEqual(row, { defaultCommissionRate: 4, maxStoresPerSeller: 3, stripeCommissionNote: 'Stripe fees are separate.', settingsRevision: 2, updatedAt: T1.toISOString() });
  assert.equal('_id' in row, false);
  assert.deepEqual(toSettingsRow({ _id: SETTINGS_ID }), { defaultCommissionRate: 4, maxStoresPerSeller: 3, stripeCommissionNote: null, settingsRevision: 0, updatedAt: null });
  const unusable = toSettingsRow({ _id: SETTINGS_ID, defaultCommissionRate: -3, maxStoresPerSeller: 0, stripeCommissionNote: '', settingsRevision: -1 });
  assert.equal(unusable.defaultCommissionRate, 4);
  assert.equal(unusable.maxStoresPerSeller, 3);
  assert.equal(unusable.stripeCommissionNote, null);
  assert.equal(unusable.settingsRevision, 0);
  assert.deepEqual(Object.keys(settingsSnapshot(row)).sort(), [...SETTINGS_FIELDS].sort());
});

test('changedFields ignores equal values; needsSync is true only for settings the seller receives', () => {
  const row = toSettingsRow(stored);
  assert.deepEqual(changedFields(row, { defaultCommissionRate: 4, maxStoresPerSeller: 3 }), []);
  assert.deepEqual(changedFields(row, { defaultCommissionRate: 5, maxStoresPerSeller: 3, stripeCommissionNote: null }), ['defaultCommissionRate', 'stripeCommissionNote']);
  assert.equal(needsSync(['stripeCommissionNote']), false);
  assert.equal(needsSync(['stripeCommissionNote', 'maxStoresPerSeller']), true);
  assert.equal(needsSync([]), false);
});

test('revisionFilter matches an unbumped document as 0 or missing, and a bumped one exactly', () => {
  assert.deepEqual(revisionFilter(SETTINGS_ID, 0), { _id: SETTINGS_ID, settingsRevision: { $in: [0, null] } });
  assert.deepEqual(revisionFilter(SETTINGS_ID, 4), { _id: SETTINGS_ID, settingsRevision: 4 });
});

test('buildSettingsUpdate sets what changed, removes a cleared note, and advances the revision', () => {
  assert.deepEqual(buildSettingsUpdate({ defaultCommissionRate: 5 }, ['defaultCommissionRate']), { $inc: { settingsRevision: 1 }, $set: { defaultCommissionRate: 5 } });
  assert.deepEqual(buildSettingsUpdate({ stripeCommissionNote: null }, ['stripeCommissionNote']), { $inc: { settingsRevision: 1 }, $unset: { stripeCommissionNote: 1 } });
  const both = buildSettingsUpdate({ maxStoresPerSeller: 6, stripeCommissionNote: null }, ['maxStoresPerSeller', 'stripeCommissionNote']);
  assert.deepEqual(both, { $inc: { settingsRevision: 1 }, $set: { maxStoresPerSeller: 6 }, $unset: { stripeCommissionNote: 1 } });
});

test('buildRevertUpdate restores stored values, removes what was absent, and puts the revision back', () => {
  const undo = buildRevertUpdate({ defaultCommissionRate: 4 }, ['defaultCommissionRate', 'stripeCommissionNote'], 2);
  assert.deepEqual(undo, { $set: { settingsRevision: 2, defaultCommissionRate: 4 }, $unset: { stripeCommissionNote: 1 } });
  assert.deepEqual(buildRevertUpdate({ maxStoresPerSeller: 3 }, ['maxStoresPerSeller'], 0), { $set: { settingsRevision: 0, maxStoresPerSeller: 3 } });
});

test('every method refuses a missing token, a seller token, and a non-admin account', async () => {
  const restore = install();
  try {
    const sellerToken = await token('seller', 'seller-backend');
    for (const bearer of [null, sellerToken]) {
      assert.equal((await route.GET(await send('GET', undefined, bearer))).status, 401);
      assert.equal((await route.PATCH(await send('PATCH', { defaultCommissionRate: 5 }, bearer))).status, 401);
    }
    UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'seller' }) }) });
    assert.equal((await route.GET(await send('GET'))).status, 401);
    assert.equal((await route.PATCH(await send('PATCH', { defaultCommissionRate: 5 }))).status, 401);
    assert.equal(calls.finds.length + calls.updates.length + calls.reverts.length + calls.audits.length + calls.outbox.length, 0);
  } finally {
    restore();
  }
});

test('GET answers the settings in the wire shape, with no store header and no _id', async () => {
  const restore = install();
  try {
    const response = await route.GET(await send('GET'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.deepEqual(body, {
      settings: { defaultCommissionRate: 4, maxStoresPerSeller: 3, stripeCommissionNote: 'Stripe fees are separate.', settingsRevision: 2, updatedAt: T1.toISOString() },
    });
    assert.deepEqual(calls.finds, [{ globalType: 'platformSettings' }]);
  } finally {
    restore();
  }
});

test('GET and PATCH are 404 when the platform has no settings document, and nothing is created', async () => {
  const restore = install({ found: null });
  try {
    assert.equal((await route.GET(await send('GET'))).status, 404);
    assert.equal((await route.PATCH(await send('PATCH', { defaultCommissionRate: 5 }))).status, 404);
    assert.equal(calls.updates.length + calls.audits.length + calls.outbox.length, 0);
  } finally {
    restore();
  }
});

test('PATCH changes the default rate, audits before and after with the reason, and queues the seller sync', async () => {
  const restore = install();
  try {
    const response = await route.PATCH(await send('PATCH', { defaultCommissionRate: 6.5, reason: 'Q4 pricing' }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.settings.defaultCommissionRate, 6.5);
    assert.equal(body.settings.settingsRevision, 3);
    assert.equal(body.settings.updatedAt, T2.toISOString());
    assert.equal(typeof body.queued.eventId, 'string');
    assert.equal(body.queued.revision, 1);

    assert.deepEqual(calls.updates[0], {
      filter: { _id: SETTINGS_ID, settingsRevision: 2 },
      update: { $inc: { settingsRevision: 1 }, $set: { defaultCommissionRate: 6.5 } },
    });
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0].action, 'settings.update');
    assert.equal(calls.audits[0].entity, 'platformSettings');
    assert.equal(calls.audits[0].entityId, SETTINGS_ID);
    assert.equal(calls.audits[0].actorId, ADMIN_ID);
    assert.equal(calls.audits[0].details.reason, 'Q4 pricing');
    assert.deepEqual(calls.audits[0].details.changed, ['defaultCommissionRate']);
    assert.equal(calls.audits[0].details.before.defaultCommissionRate, 4);
    assert.equal(calls.audits[0].details.after.defaultCommissionRate, 6.5);
    assert.equal('settingsRevision' in calls.audits[0].details.before, false);

    assert.equal(calls.outbox.length, 1);
    assert.equal(calls.outbox[0].target, 'seller');
    assert.equal(calls.outbox[0].entity, 'platform');
    assert.equal(calls.outbox[0].entityId, 'platform');
    assert.equal(calls.outbox[0].group, 'settings');
    assert.deepEqual(calls.outbox[0].payload, { defaultCommissionRate: 6.5, maxStoresPerSeller: 3 });
    assert.equal(calls.reverts.length, 0);
  } finally {
    restore();
  }
});

test('PATCH of the note alone is audited and moves the revision, but sends nothing to the seller', async () => {
  const restore = install();
  try {
    const response = await route.PATCH(await send('PATCH', { stripeCommissionNote: '   ' }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.settings.stripeCommissionNote, null);
    assert.equal(body.queued, null);
    assert.deepEqual(calls.updates[0].update, { $inc: { settingsRevision: 1 }, $unset: { stripeCommissionNote: 1 } });
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0].details.reason, null);
    assert.equal(calls.outbox.length, 0);
  } finally {
    restore();
  }
});

test('PATCH of an unbumped document matches revision 0 or missing', async () => {
  const { settingsRevision: _omitted, ...unbumped } = stored;
  const restore = install({ found: unbumped });
  try {
    const response = await route.PATCH(await send('PATCH', { maxStoresPerSeller: 5 }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.updates[0].filter, { _id: SETTINGS_ID, settingsRevision: { $in: [0, null] } });
    assert.equal(((await response.json()) as any).settings.settingsRevision, 1);
  } finally {
    restore();
  }
});

test('PATCH with the values already stored changes nothing: no write, no audit entry, no sync event', async () => {
  const restore = install();
  try {
    const response = await route.PATCH(await send('PATCH', { defaultCommissionRate: 4, maxStoresPerSeller: 3 }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.queued, null);
    assert.equal(body.settings.settingsRevision, 2);
    assert.equal(calls.updates.length + calls.audits.length + calls.outbox.length, 0);
  } finally {
    restore();
  }
});

test('PATCH: a non-JSON body is 400; a bad value, an unknown field, and an empty change are 422; nothing is written', async () => {
  const restore = install();
  try {
    assert.equal((await route.PATCH(await send('PATCH', 'not json'))).status, 400);
    const bodies: unknown[] = [{}, { reason: 'x' }, { defaultCommissionRate: 101 }, { maxStoresPerSeller: 0 }, { defaultCommissionRate: 5, settingsRevision: 50 }, { globalType: 'x', defaultCommissionRate: 5 }];
    for (const body of bodies) assert.equal((await route.PATCH(await send('PATCH', body))).status, 422, JSON.stringify(body));
    const response = await route.PATCH(await send('PATCH', { defaultCommissionRate: -2 }));
    assert.deepEqual(((await response.json()) as any).issues, [{ path: 'defaultCommissionRate', message: 'must be a number from 0 to 100' }]);
    assert.equal(calls.finds.length, 0);
    assert.equal(calls.updates.length + calls.audits.length + calls.outbox.length, 0);
  } finally {
    restore();
  }
});

test('PATCH: if someone else changed the settings since they were read, it is 409 and nothing else is written', async () => {
  const restore = install({ updated: null });
  try {
    const response = await route.PATCH(await send('PATCH', { defaultCommissionRate: 5 }));
    assert.equal(response.status, 409);
    assert.equal(calls.audits.length + calls.outbox.length + calls.reverts.length, 0);
  } finally {
    restore();
  }
});

test('PATCH: if the audit entry fails, the old values and revision are put back and the call fails', async () => {
  const restore = install({ auditFails: true });
  try {
    const response = await route.PATCH(await send('PATCH', { defaultCommissionRate: 6.5, stripeCommissionNote: null }));
    assert.equal(response.status, 500);
    assert.equal(calls.outbox.length, 0);
    assert.equal(calls.reverts.length, 1);
    assert.deepEqual(calls.reverts[0].filter, { _id: SETTINGS_ID, settingsRevision: 3 });
    assert.deepEqual(calls.reverts[0].update, { $set: { settingsRevision: 2, defaultCommissionRate: 4, stripeCommissionNote: 'Stripe fees are separate.' } });
  } finally {
    restore();
  }
});

test('PATCH: if the sync event cannot be queued, the old values are put back and the call fails', async () => {
  const restore = install({ outboxFails: true });
  try {
    const response = await route.PATCH(await send('PATCH', { maxStoresPerSeller: 8 }));
    assert.equal(response.status, 500);
    assert.deepEqual(((await response.json()) as any).error, 'The change could not be recorded and was not applied');
    assert.equal(calls.reverts.length, 1);
    assert.deepEqual(calls.reverts[0].update, { $set: { settingsRevision: 2, maxStoresPerSeller: 3 } });
  } finally {
    restore();
  }
});

test('PATCH: a field the document never had is removed again when the change is rolled back', async () => {
  const { stripeCommissionNote: _omitted, ...noNote } = stored;
  const restore = install({ found: noNote, auditFails: true });
  try {
    const response = await route.PATCH(await send('PATCH', { stripeCommissionNote: 'new note' }));
    assert.equal(response.status, 500);
    assert.deepEqual(calls.reverts[0].update, { $set: { settingsRevision: 2 }, $unset: { stripeCommissionNote: 1 } });
  } finally {
    restore();
  }
});

test('the policy decides: with the admin actor removed from read or update, the route is 403 and nothing is written', async () => {
  const original = POLICY.platformSettings;
  const restore = install();
  try {
    POLICY.platformSettings = { ...original, read: { actors: ['system'], fields: '*' } };
    assert.equal((await route.GET(await send('GET'))).status, 403);
    assert.equal(calls.finds.length, 0);

    POLICY.platformSettings = { ...original, update: { actors: ['system'], fields: { system: '*' } } };
    assert.equal((await route.PATCH(await send('PATCH', { defaultCommissionRate: 5 }))).status, 403);

    // The revision is written as the system actor: without that right the route refuses before it reads or writes.
    POLICY.platformSettings = { ...original, update: { actors: ['admin'], fields: { admin: ['defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote'] } } };
    assert.equal((await route.PATCH(await send('PATCH', { defaultCommissionRate: 5 }))).status, 403);

    // The operator may not write the revision: a field list that lacks one of the settings denies the whole request.
    POLICY.platformSettings = { ...original, update: { actors: ['admin', 'system'], fields: { admin: ['defaultCommissionRate'], system: '*' } } };
    assert.equal((await route.PATCH(await send('PATCH', { defaultCommissionRate: 5 }))).status, 403);
    assert.equal(calls.finds.length + calls.updates.length + calls.audits.length + calls.outbox.length, 0);
  } finally {
    POLICY.platformSettings = original;
    restore();
  }
  const again = install();
  try {
    assert.equal((await route.GET(await send('GET'))).status, 200);
  } finally {
    again();
  }
});
