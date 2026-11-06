import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { assertCan, CommissionLedgerModel, PlatformSettingsModel, Store, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import {
  LEDGER_SELECT,
  buildLedgerFilter,
  buildRatesFilter,
  parseLedgerQuery,
  parseRatesQuery,
  resolveEffectiveRate,
  toDefaultRate,
  toLedgerRow,
  toLedgerTotals,
  toRateRow,
} from '@/lib/admin-commission';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const STORE_ID = '65a000000000000000000010';
const ROW_ID = '65a0000000000000000000b1';
const T1 = new Date('2026-10-11T09:00:00.000Z');

const LedgerModel = CommissionLedgerModel as any;
const SettingsModel = PlatformSettingsModel as any;
const StoreModel = Store as any;
const UserModel = User as any;

let ledgerGET: (request: Request) => Promise<Response>;
let ratesGET: (request: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  ledgerGET = (await import('../src/app/api/admin/commission/ledger/route')).GET;
  ratesGET = (await import('../src/app/api/admin/commission/rates/route')).GET;
});

const calls = { ledgerFind: [] as any[], ledgerCount: [] as any[], aggregate: [] as any[], storeFind: [] as any[], storeCount: [] as any[], selects: [] as string[], skip: [] as number[] };

interface Stub {
  role?: string;
  rows?: unknown[];
  total?: number;
  groups?: unknown[];
  matchedStores?: unknown[];
  storeNames?: unknown[];
  stores?: unknown[];
  settings?: unknown;
}

function install(stub: Stub): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    ledgerFind: LedgerModel.find,
    ledgerCount: LedgerModel.countDocuments,
    aggregate: LedgerModel.aggregate,
    storeFind: StoreModel.find,
    storeCount: StoreModel.countDocuments,
    settingsFindOne: SettingsModel.findOne,
  };
  for (const list of Object.values(calls)) (list as unknown[]).length = 0;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: stub.role ?? 'admin' }) }) });
  LedgerModel.find = (filter: unknown) => {
    calls.ledgerFind.push(filter);
    const q: any = { select: (s: string) => (calls.selects.push(s), q), sort: () => q, skip: (n: number) => (calls.skip.push(n), q), limit: () => q, lean: async () => stub.rows ?? [] };
    return q;
  };
  LedgerModel.countDocuments = async (filter: unknown) => (calls.ledgerCount.push(filter), stub.total ?? (stub.rows ?? []).length);
  LedgerModel.aggregate = async (pipeline: unknown) => (calls.aggregate.push(pipeline), stub.groups ?? []);
  StoreModel.find = (filter: any) => {
    calls.storeFind.push(filter);
    const byId = Boolean(filter && filter._id && filter._id.$in);
    const q: any = {
      select: (s: string) => (calls.selects.push(s), q),
      sort: () => q,
      skip: (n: number) => (calls.skip.push(n), q),
      limit: () => q,
      lean: async () => (byId ? (stub.storeNames ?? []) : (stub.matchedStores ?? stub.stores ?? [])),
    };
    return q;
  };
  StoreModel.countDocuments = async (filter: unknown) => (calls.storeCount.push(filter), stub.total ?? (stub.stores ?? []).length);
  SettingsModel.findOne = () => ({ select: () => ({ lean: async () => stub.settings ?? null }) });
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    LedgerModel.find = originals.ledgerFind;
    LedgerModel.countDocuments = originals.ledgerCount;
    LedgerModel.aggregate = originals.aggregate;
    StoreModel.find = originals.storeFind;
    StoreModel.countDocuments = originals.storeCount;
    SettingsModel.findOne = originals.settingsFindOne;
  };
}

async function request(path: string, token?: string | null): Promise<Request> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  return new Request('http://admin.test' + path, { headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });
}

const ledgerRow = {
  _id: ROW_ID,
  store: STORE_ID,
  orderAmount: 125000,
  commissionRate: 4,
  commissionAmount: 5000,
  status: 'pending',
  paymentMethod: 'card',
  createdAt: T1,
  orderId: 'ORD-1',
  sellerOrderDocId: 'seller-doc-1',
  stripePaymentIntentId: 'pi_secret',
  applicationFeeId: 'fee_secret',
};

test('the admin policy cannot read the order identifiers, and the route selects none of them', () => {
  for (const field of ['orderId', 'sellerOrderDocId', 'stripePaymentIntentId', 'applicationFeeId']) {
    assert.throws(() => assertCan('admin', 'read', 'commissionLedger', [field]), /may not read/, field);
    assert.equal(LEDGER_SELECT.split(' ').includes(field), false, field);
  }
  assert.doesNotThrow(() => assertCan('admin', 'read', 'commissionLedger', LEDGER_SELECT.split(' ')));
});

test('parseLedgerQuery reads page, limit, q, and status, and refuses anything malformed', () => {
  assert.deepEqual(parseLedgerQuery(new URLSearchParams()), { ok: true, query: { page: 1, limit: 20, q: null, status: null } });
  assert.deepEqual(parseLedgerQuery(new URLSearchParams('page=2&q=%20looms%20&status=settled')), { ok: true, query: { page: 2, limit: 20, q: 'looms', status: 'settled' } });
  for (const bad of ['status=paid', 'page=0', 'limit=101', 'q=' + 'a'.repeat(101)]) assert.equal(parseLedgerQuery(new URLSearchParams(bad)).ok, false, bad);
});

test('buildLedgerFilter matches search text literally and combines the status with it', () => {
  const base = { page: 1, limit: 20, q: null, status: null };
  assert.deepEqual(buildLedgerFilter(base, []), {});
  assert.deepEqual(buildLedgerFilter({ ...base, status: 'pending' }, []), { status: 'pending' });
  const literal = buildLedgerFilter({ ...base, q: 'a.b(' }, [STORE_ID]) as any;
  assert.equal(literal.$or[0].settlementRef.$regex, 'a\\.b\\(');
  assert.deepEqual(literal.$or[1], { store: { $in: [STORE_ID] } });
  const byId = buildLedgerFilter({ ...base, q: STORE_ID }, []) as any;
  assert.deepEqual(byId.$or[1], { store: STORE_ID });
  const both = buildLedgerFilter({ ...base, q: 'x', status: 'settled' }, []) as any;
  assert.deepEqual(both.$and[0], { status: 'settled' });
  assert.equal(Array.isArray(both.$and[1].$or), true);
});

test('toLedgerRow uses id, resolves the store name, keeps a refund negative, and carries no order identifier', () => {
  const row = toLedgerRow({ ...ledgerRow, commissionAmount: -5000, orderAmount: -125000 }, new Map([[STORE_ID, 'Lahore Looms']])) as any;
  assert.equal(row.id, ROW_ID);
  assert.deepEqual(row.store, { id: STORE_ID, name: 'Lahore Looms' });
  assert.equal(row.commissionAmount, -5000);
  assert.equal(row.orderAmount, -125000);
  for (const key of ['_id', 'orderId', 'sellerOrderDocId', 'stripePaymentIntentId', 'applicationFeeId']) assert.equal(key in row, false, key);
  assert.equal(row.settlementDate, null);
  assert.equal(row.settlementRef, null);
  const loose = toLedgerRow({ _id: ROW_ID, status: 'weird', paymentMethod: 'cheque', commissionRate: 'x' }, new Map()) as any;
  assert.equal(loose.store, null);
  assert.equal(loose.status, 'pending');
  assert.equal(loose.paymentMethod, null);
  assert.equal(loose.commissionRate, 0);
  assert.equal(toLedgerRow(ledgerRow, new Map()).store?.name, '(unknown store)');
});

test('toLedgerTotals reads the grouped totals, zeroes a missing status, and ignores other groups', () => {
  const totals = toLedgerTotals([
    { _id: 'pending', count: 3, orderAmount: 300000, commissionAmount: 12000 },
    { _id: null, count: 9, orderAmount: 1, commissionAmount: 1 },
    { _id: 'refunded', count: 9, orderAmount: 1, commissionAmount: 1 },
  ]);
  assert.deepEqual(totals.pending, { count: 3, orderAmount: 300000, commissionAmount: 12000 });
  assert.deepEqual(totals.settled, { count: 0, orderAmount: 0, commissionAmount: 0 });
  assert.deepEqual(toLedgerTotals('nope').pending, { count: 0, orderAmount: 0, commissionAmount: 0 });
});

test('the ledger needs an admin token and reads nothing without one', async () => {
  const restore = install({});
  try {
    assert.equal((await ledgerGET(await request('/api/admin/commission/ledger', null))).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await ledgerGET(await request('/api/admin/commission/ledger', seller))).status, 401);
    assert.equal(calls.ledgerFind.length, 0);
    assert.equal(calls.aggregate.length, 0);
  } finally {
    restore();
  }
});

test('the ledger answers a page with store names and the totals over the whole ledger', async () => {
  const restore = install({
    rows: [ledgerRow],
    total: 41,
    groups: [{ _id: 'pending', count: 1, orderAmount: 125000, commissionAmount: 5000 }, { _id: 'settled', count: 40, orderAmount: 9000000, commissionAmount: 360000 }],
    storeNames: [{ _id: STORE_ID, name: 'Lahore Looms' }],
  });
  try {
    const response = await ledgerGET(await request('/api/admin/commission/ledger?page=2&limit=20'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.equal(body.totalDocs, 41);
    assert.equal(body.totalPages, 3);
    assert.equal(body.docs[0].id, ROW_ID);
    assert.deepEqual(body.docs[0].store, { id: STORE_ID, name: 'Lahore Looms' });
    assert.equal('orderId' in body.docs[0], false);
    assert.equal('stripePaymentIntentId' in body.docs[0], false);
    assert.equal(body.totals.settled.commissionAmount, 360000);
    assert.equal(body.totals.pending.count, 1);
    assert.deepEqual(calls.ledgerFind[0], {});
    assert.equal(calls.skip[0], 20);
    assert.equal(calls.selects[0], LEDGER_SELECT);
    assert.equal(calls.storeFind.length, 1);
  } finally {
    restore();
  }
});

test('a ledger search resolves stores first and filters by status', async () => {
  const restore = install({ rows: [], total: 0, matchedStores: [{ _id: STORE_ID }] });
  try {
    const response = await ledgerGET(await request('/api/admin/commission/ledger?q=looms&status=settled'));
    assert.equal(response.status, 200);
    const filter = calls.ledgerFind[0] as any;
    assert.deepEqual(filter.$and[0], { status: 'settled' });
    assert.deepEqual(filter.$and[1].$or[1], { store: { $in: [STORE_ID] } });
    assert.equal(filter.$and[1].$or[0].settlementRef.$regex, 'looms');
    const body = (await response.json()) as any;
    assert.equal(body.totalPages, 0);
  } finally {
    restore();
  }
});

test('an invalid ledger query is 422 and reads nothing', async () => {
  const restore = install({});
  try {
    const response = await ledgerGET(await request('/api/admin/commission/ledger?status=paid'));
    assert.equal(response.status, 422);
    assert.equal(calls.ledgerFind.length, 0);
    assert.equal(calls.aggregate.length, 0);
    assert.equal(calls.storeFind.length, 0);
  } finally {
    restore();
  }
});

test('resolveEffectiveRate follows the billing rule: inherit uses the default, custom or no mode uses the own rate', () => {
  assert.equal(resolveEffectiveRate('inherit', 7, 4), 4);
  assert.equal(resolveEffectiveRate('custom', 7, 4), 7);
  assert.equal(resolveEffectiveRate(undefined, 7, 4), 7);
  assert.equal(resolveEffectiveRate('inherit', 7, null), 7);
  assert.equal(resolveEffectiveRate('custom', 'x', 4), null);
  assert.equal(resolveEffectiveRate('inherit', null, null), null);
  assert.equal(toDefaultRate({ defaultCommissionRate: 4 }), 4);
  assert.equal(toDefaultRate({ defaultCommissionRate: -1 }), null);
  assert.equal(toDefaultRate(null), null);
});

test('parseRatesQuery and buildRatesFilter: the custom filter is every store that does not inherit', () => {
  assert.deepEqual(parseRatesQuery(new URLSearchParams()), { ok: true, query: { page: 1, limit: 20, q: null, mode: null } });
  assert.equal(parseRatesQuery(new URLSearchParams('mode=fixed')).ok, false);
  const base = { page: 1, limit: 20, q: null, mode: null };
  assert.deepEqual(buildRatesFilter(base), {});
  assert.deepEqual(buildRatesFilter({ ...base, mode: 'inherit' }), { commissionMode: 'inherit' });
  assert.deepEqual(buildRatesFilter({ ...base, mode: 'custom' }), { commissionMode: { $ne: 'inherit' } });
  const searched = buildRatesFilter({ ...base, q: 'a.b' }) as any;
  assert.equal(searched.$or[0].name.$regex, 'a\\.b');
});

test('toRateRow resolves the effective rate and uses id', () => {
  const row = toRateRow({ _id: STORE_ID, name: 'Looms', status: 'active', commissionMode: 'inherit', commissionRate: 0 }, 4) as any;
  assert.equal(row.id, STORE_ID);
  assert.equal(row.commissionMode, 'inherit');
  assert.equal(row.effectiveRate, 4);
  assert.equal('_id' in row, false);
  const legacy = toRateRow({ _id: STORE_ID, name: 'Old', status: 'active', commissionRate: 6 }, 4);
  assert.equal(legacy.commissionMode, 'custom');
  assert.equal(legacy.effectiveRate, 6);
});

test('the rates route answers the default rate and a resolved rate per store', async () => {
  const stores = [
    { _id: STORE_ID, name: 'Looms', status: 'active', commissionMode: 'inherit', commissionRate: 0 },
    { _id: '65a000000000000000000011', name: 'Rugs', status: 'suspended', commissionMode: 'custom', commissionRate: 7.5 },
  ];
  const restore = install({ stores, total: 2, settings: { defaultCommissionRate: 4 } });
  try {
    const response = await ratesGET(await request('/api/admin/commission/rates?mode=custom'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as any;
    assert.equal(body.defaultRate, 4);
    assert.equal(body.totalDocs, 2);
    assert.equal(body.docs[0].effectiveRate, 4);
    assert.equal(body.docs[1].effectiveRate, 7.5);
    assert.deepEqual(calls.storeFind[0], { commissionMode: { $ne: 'inherit' } });
  } finally {
    restore();
  }
});

test('the rates route reports a null default when the settings are missing, and needs an admin token', async () => {
  const restore = install({ stores: [], total: 0, settings: null });
  try {
    const body = (await (await ratesGET(await request('/api/admin/commission/rates'))).json()) as any;
    assert.equal(body.defaultRate, null);
    assert.equal(body.totalPages, 0);
    assert.equal((await ratesGET(await request('/api/admin/commission/rates', null))).status, 401);
    assert.equal((await ratesGET(await request('/api/admin/commission/rates?mode=fixed'))).status, 422);
  } finally {
    restore();
  }
});
