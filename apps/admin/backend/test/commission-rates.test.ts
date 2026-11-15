import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, CommissionRateHistory, PlatformSettingsModel, Store, User, registerSyncOutboxModel, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { hasOneDecimal, parseHistoryQuery, parseRate, parseRateChange, toStoreRateView } from '@/lib/admin-commission-rates';

// Sprint 4 EP-05.US02 (D-089): changing a store's commission rate and the platform default. Models are stubbed; no database.

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const STORE_ID = '65a000000000000000000010';
const SETTINGS_ID = '65a0000000000000000000a0';
const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;
const HistoryModel = CommissionRateHistory as any;
const SettingsModel = PlatformSettingsModel as any;

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let storePUT: Handler;
let storeDELETE: Handler;
let storeGET: Handler;
let defaultPUT: (request: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  const store = await import('../src/app/api/admin/commission/stores/[id]/route');
  storePUT = store.PUT;
  storeDELETE = store.DELETE;
  storeGET = store.GET;
  defaultPUT = (await import('../src/app/api/admin/commission/default/route')).PUT;
});

const outbox: Array<Record<string, any>> = [];
let outboxFails = false;
const audits: Array<Record<string, any>> = [];
const history: Array<Record<string, any>> = [];
const storeUpdates: Array<{ filter: any; update: any }> = [];
const settingsUpdates: Array<{ filter: any; update: any }> = [];
let storeMatches = true;

function chain(value: unknown): any {
  const c: any = { sort: () => c, lean: () => c, exec: async () => value };
  return c;
}

const fakeOutbox = {
  create: async (doc: Record<string, any>) => {
    if (outboxFails) throw new Error('outbox down');
    outbox.push(doc);
    return doc;
  },
  find: () => chain([]),
  findOne: () => chain(null),
  updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
  updateMany: async () => ({ matchedCount: 0, modifiedCount: 0 }),
};

function install(storeDoc: Record<string, unknown> | null, settingsDoc: Record<string, unknown> | null = { _id: SETTINGS_ID, defaultCommissionRate: 4, maxStoresPerSeller: 3, storeApprovalRequired: false, settingsRevision: 2 }): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    sFindById: StoreModel.findById,
    sUpdateOne: StoreModel.updateOne,
    userFindById: UserModel.findById,
    audit: AuditModel.create,
    history: HistoryModel.create,
    settingsFindOne: SettingsModel.findOne,
    settingsFOAU: SettingsModel.findOneAndUpdate,
    settingsUpdateOne: SettingsModel.updateOne,
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findById = () => ({ select: () => ({ lean: async () => storeDoc }) });
  StoreModel.updateOne = async (filter: any, update: any) => {
    storeUpdates.push({ filter, update });
    return { matchedCount: storeMatches ? 1 : 0, modifiedCount: 1 };
  };
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin' }) }) });
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: '65a000000000000000000099' };
  };
  HistoryModel.create = async (doc: Record<string, any>) => {
    history.push(doc);
    return doc;
  };
  SettingsModel.findOne = () => ({ select: () => ({ lean: async () => settingsDoc }) });
  SettingsModel.findOneAndUpdate = (filter: any, update: any) => {
    settingsUpdates.push({ filter, update });
    return { select: () => ({ lean: async () => ({ ...settingsDoc, ...(update.$set ?? {}), settingsRevision: Number(settingsDoc?.settingsRevision ?? 0) + 1 }) }) };
  };
  SettingsModel.updateOne = async () => ({ matchedCount: 1 });
  registerSyncOutboxModel(fakeOutbox as any);
  for (const list of [outbox, audits, history, storeUpdates, settingsUpdates]) list.length = 0;
  outboxFails = false;
  storeMatches = true;
  return () => {
    (mongoose as any).connect = originals.connect;
    StoreModel.findById = originals.sFindById;
    StoreModel.updateOne = originals.sUpdateOne;
    UserModel.findById = originals.userFindById;
    AuditModel.create = originals.audit;
    HistoryModel.create = originals.history;
    SettingsModel.findOne = originals.settingsFindOne;
    SettingsModel.findOneAndUpdate = originals.settingsFOAU;
    SettingsModel.updateOne = originals.settingsUpdateOne;
  };
}

async function send(handler: Handler, method: string, body: unknown, token?: string | null): Promise<Response> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  const request = new Request('http://admin.test/api/admin/commission/stores/' + STORE_ID, {
    method,
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve({ id: STORE_ID }) });
}

const inheriting = { _id: STORE_ID, name: 'Looms', commissionMode: 'inherit', commissionRate: 0, govRevision: 3 };
const custom = { _id: STORE_ID, name: 'Looms', commissionMode: 'custom', commissionRate: 6, govRevision: 3 };

test('rate bounds: 0 to 100, one decimal, a number', () => {
  for (const ok of [0, 4, 4.5, 100, 0.1]) assert.equal(parseRate(ok), ok);
  for (const bad of [-1, -0.1, 100.1, 101, 4.55, 4.05, Number.NaN, Number.POSITIVE_INFINITY, '4', null, undefined]) assert.equal(parseRate(bad), null, String(bad));
  assert.equal(hasOneDecimal(4.1), true);
  assert.equal(hasOneDecimal(4.12), false);
});

test('parseRateChange needs a rate (a set) and a reason of 3 to 500 characters, and refuses other fields', () => {
  assert.equal(parseRateChange({ rate: 5 }, 'set').ok, false);
  assert.equal(parseRateChange({ rate: 5, reason: 'no' }, 'set').ok, false);
  assert.equal(parseRateChange({ rate: 101, reason: 'because' }, 'set').ok, false);
  assert.equal(parseRateChange({ rate: 5, reason: 'because', status: 'active' }, 'set').ok, false);
  assert.equal(parseRateChange({ reason: 'x'.repeat(501) }, 'clear').ok, false);
  assert.deepEqual(parseRateChange({ rate: 5.5, reason: ' promo ' }, 'set'), { ok: true, data: { rate: 5.5, reason: 'promo' } });
  assert.deepEqual(parseRateChange({ reason: 'back to default' }, 'clear'), { ok: true, data: { rate: null, reason: 'back to default' } });
  assert.equal(parseRateChange({ rate: 5, reason: 'because' }, 'clear').ok, false);
});

test('parseHistoryQuery reads page, store and scope and refuses bad values', () => {
  assert.equal(parseHistoryQuery(new URLSearchParams('storeId=nope')).ok, false);
  assert.equal(parseHistoryQuery(new URLSearchParams('scope=other')).ok, false);
  assert.equal(parseHistoryQuery(new URLSearchParams('page=0')).ok, false);
  assert.equal(parseHistoryQuery(new URLSearchParams('scope=platform&page=2')).ok, true);
});

test('toStoreRateView: a custom store shows its rate, an inheriting one shows the default', () => {
  assert.deepEqual(toStoreRateView(custom, 4), { storeId: STORE_ID, name: 'Looms', mode: 'custom', customRate: 6, defaultRate: 4, effectiveRate: 6 });
  assert.deepEqual(toStoreRateView(inheriting, 4), { storeId: STORE_ID, name: 'Looms', mode: 'inherit', customRate: null, defaultRate: 4, effectiveRate: 4 });
});

test('no token, or a seller token, is 401 and nothing is written (only an admin can set a rate)', async () => {
  const restore = install(inheriting);
  try {
    assert.equal((await send(storePUT, 'PUT', { rate: 5, reason: 'policy' }, null)).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await send(storePUT, 'PUT', { rate: 5, reason: 'policy' }, seller)).status, 401);
    assert.equal((await send(storeDELETE, 'DELETE', { reason: 'policy' }, seller)).status, 401);
    assert.equal(storeUpdates.length, 0);
    assert.equal(history.length, 0);
  } finally {
    restore();
  }
});

test('an invalid rate or a missing reason is 422 and nothing is written', async () => {
  const restore = install(inheriting);
  try {
    for (const body of [{ rate: -1, reason: 'policy' }, { rate: 100.5, reason: 'policy' }, { rate: 4.25, reason: 'policy' }, { rate: 5 }, { rate: 5, reason: 'x' }]) {
      assert.equal((await send(storePUT, 'PUT', body)).status, 422, JSON.stringify(body));
    }
    assert.equal(storeUpdates.length + history.length + audits.length + outbox.length, 0);
  } finally {
    restore();
  }
});

test('setting a custom rate writes the store, a history row, an audit entry and queues the seller sync', async () => {
  const restore = install(inheriting);
  try {
    const response = await send(storePUT, 'PUT', { rate: 5.5, reason: 'negotiated' });
    assert.equal(response.status, 200);

    assert.deepEqual(storeUpdates[0].filter, { _id: STORE_ID, govRevision: 3 });
    assert.deepEqual(storeUpdates[0].update.$set, { commissionMode: 'custom', commissionRate: 5.5 });
    assert.deepEqual(storeUpdates[0].update.$inc, { govRevision: 1 });

    assert.equal(history.length, 1);
    assert.deepEqual([history[0].scope, history[0].actor, history[0].oldMode, history[0].oldRate, history[0].newMode, history[0].newRate, history[0].reason], ['store', ADMIN_ID, 'inherit', null, 'custom', 5.5, 'negotiated']);

    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'commission.store_rate_set');
    assert.equal(audits[0].actorId, ADMIN_ID);
    assert.equal(audits[0].details.reason, 'negotiated');
    assert.equal(audits[0].details.after.rate, 5.5);

    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].group, 'governance');
    assert.equal(outbox[0].target, 'seller');
    assert.deepEqual(outbox[0].payload, { commissionMode: 'custom', commissionRate: 5.5 });
  } finally {
    restore();
  }
});

test('clearing the rate sends the store back to the platform default, with history and audit', async () => {
  const restore = install(custom);
  try {
    const response = await send(storeDELETE, 'DELETE', { reason: 'contract ended' });
    assert.equal(response.status, 200);
    assert.deepEqual(storeUpdates[0].update.$set, { commissionMode: 'inherit', commissionRate: 0 });
    assert.deepEqual([history[0].oldMode, history[0].oldRate, history[0].newMode, history[0].newRate], ['custom', 6, 'inherit', null]);
    assert.equal(audits[0].action, 'commission.store_rate_cleared');
    assert.deepEqual(outbox[0].payload, { commissionMode: 'inherit', commissionRate: 0 });
  } finally {
    restore();
  }
});

test('setting the rate it already has changes nothing', async () => {
  const restore = install(custom);
  try {
    const body = (await (await send(storePUT, 'PUT', { rate: 6, reason: 'same again' })).json()) as any;
    assert.equal(body.changed, false);
    assert.equal(storeUpdates.length + history.length + audits.length + outbox.length, 0);
  } finally {
    restore();
  }
});

test('two operators cannot both win: a lost compare-and-set is 409 and records nothing', async () => {
  const restore = install(inheriting);
  try {
    storeMatches = false;
    assert.equal((await send(storePUT, 'PUT', { rate: 7, reason: 'race' })).status, 409);
    assert.equal(history.length + audits.length + outbox.length, 0);
  } finally {
    restore();
  }
});

test('if the sync cannot be queued, the store is put back and the call fails', async () => {
  const restore = install(inheriting);
  const log = console.error;
  console.error = () => {};
  try {
    outboxFails = true;
    assert.equal((await send(storePUT, 'PUT', { rate: 8, reason: 'will fail' })).status, 500);
    const undo = storeUpdates[1];
    assert.deepEqual(undo.filter, { _id: STORE_ID, govRevision: 4 });
    assert.deepEqual(undo.update.$set, { commissionMode: 'inherit', commissionRate: 0, govRevision: 3 });
    assert.ok(history.some((row) => String(row.reason).startsWith('Not applied')), 'the failure is recorded');
  } finally {
    console.error = log;
    restore();
  }
});

test('an unknown store is 404', async () => {
  const restore = install(null);
  try {
    assert.equal((await send(storePUT, 'PUT', { rate: 5, reason: 'policy' })).status, 404);
    assert.equal((await send(storeGET, 'GET', undefined as never)).status, 404);
  } finally {
    restore();
  }
});

test('the platform default: a valid change is written with history, audit and the seller settings sync', async () => {
  const restore = install(inheriting);
  try {
    const request = async (body: unknown) =>
      defaultPUT(
        new Request('http://admin.test/api/admin/commission/default', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE)) },
          body: JSON.stringify(body),
        }),
      );
    assert.equal((await request({ rate: 120, reason: 'too much' })).status, 422);
    assert.equal(settingsUpdates.length + history.length, 0);

    const response = await request({ rate: 5, reason: 'new pricing' });
    assert.equal(response.status, 200);
    assert.deepEqual(settingsUpdates[0].update.$set, { defaultCommissionRate: 5 });
    assert.equal(history[0].scope, 'platform');
    assert.deepEqual([history[0].oldRate, history[0].newRate], [4, 5]);
    assert.equal(audits[0].action, 'commission.default_rate_set');
    assert.equal(outbox[0].entity, 'platform');
    assert.equal(outbox[0].group, 'settings');
    assert.equal(outbox[0].payload.defaultCommissionRate, 5);
  } finally {
    restore();
  }
});
