import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, CommissionEntry, Order, PlatformSettingsModel, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import * as dbNs from '@markaz/db-schemas';
import { unwrapCjs } from '@/lib/cjs';
import {
  codCommissionDue,
  commissionBase,
  commissionFor,
  commissionRateFor,
  recordCardEntries,
  recordCodCommission,
  reverseLedgerForOrder,
  roundRate,
  type LedgerOrder,
} from '../src/lib/commission';
import { backfillCommission } from '../src/lib/commission-backfill';

// Sprint 4 EP-05 (D-088, D-089, D-090): the commission ledger, its retry route, the reversal and the seller's rate read.
// Models are stubbed in memory (the unique index is emulated); no database.

const { assertSettlementOnlyUpdate } = unwrapCjs(dbNs) as typeof dbNs;

const SECRET = 'x'.repeat(40);
const CRON = 'c'.repeat(32);
const USER_A = '65a000000000000000000001';
const USER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const ORDER_1 = '65a0000000000000000a0001';
const ORDER_2 = '65a0000000000000000a0002';

const EntryModel = CommissionEntry as any;
const StoreModel = Store as any;
const SettingsModel = PlatformSettingsModel as any;
const OrderModel = Order as any;
const AuditModel = AuditLog as any;

let entries: Array<Record<string, any>> = [];
let storeRate: { commissionMode?: string; commissionRate?: number } = {};
let defaultRate = 4;
let createFails = false;
let aggregateOrders: Array<Record<string, any>> = [];
let audits: Array<Record<string, any>> = [];
let restore: () => void = () => {};
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let rateGET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let rateRoute: Record<string, unknown>;
let storePATCH: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let backfillPOST: (r: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  rateRoute = (await import('../src/app/api/stores/[id]/commission/route')) as unknown as Record<string, unknown>;
  rateGET = rateRoute.GET as typeof rateGET;
  storePATCH = (await import('../src/app/api/stores/[id]/route')).PATCH;
  backfillPOST = (await import('../src/app/api/internal/commission/backfill/route')).POST;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value() };
  return q;
};

const isDup = (doc: Record<string, any>) =>
  entries.some((e) => String(e.order) === String(doc.order) && e.type === doc.type && (e.reversesType ?? null) === (doc.reversesType ?? null));

beforeEach(() => {
  entries = [];
  storeRate = {};
  defaultRate = 4;
  createFails = false;
  aggregateOrders = [];
  audits = [];
  const saved = {
    readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
    connect: (mongoose as any).connect,
    create: EntryModel.create,
    find: EntryModel.find,
    sFindById: StoreModel.findById,
    sFindOne: StoreModel.findOne,
    sExists: StoreModel.exists,
    settings: SettingsModel.findOne,
    aggregate: OrderModel.aggregate,
    audit: AuditModel.create,
  };
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  (mongoose as any).connect = async () => mongoose;
  EntryModel.create = async (doc: Record<string, any>) => {
    await Promise.resolve();
    if (createFails) throw new Error('write failed: mongodb://user:password@host/db');
    if (isDup(doc)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const row = { _id: String(entries.length + 1), createdAt: new Date(), ...doc };
    entries.push(row);
    return row;
  };
  EntryModel.find = (filter: any) =>
    chain(() => entries.filter((e) => String(e.order) === String(filter.order) && (filter.type?.$ne === undefined || e.type !== filter.type.$ne)).map((e) => ({ ...e })));
  StoreModel.findById = () => chain(() => ({ ...storeRate }));
  SettingsModel.findOne = () => chain(() => ({ defaultCommissionRate: defaultRate }));
  OrderModel.aggregate = async () => aggregateOrders.filter((o) => entries.filter((e) => String(e.order) === String(o._id)).length < (o.paymentMethod === 'card' ? 2 : 1)).slice(0, 100);
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  restore = () => {
    if (saved.readyState) Object.defineProperty(mongoose.connection, 'readyState', saved.readyState);
    else delete (mongoose.connection as any).readyState;
    (mongoose as any).connect = saved.connect;
    EntryModel.create = saved.create;
    EntryModel.find = saved.find;
    StoreModel.findById = saved.sFindById;
    StoreModel.findOne = saved.sFindOne;
    StoreModel.exists = saved.sExists;
    SettingsModel.findOne = saved.settings;
    OrderModel.aggregate = saved.aggregate;
    AuditModel.create = saved.audit;
    delete process.env.OUTBOX_CRON_SECRET;
  };
});

afterEach(() => restore());

const cod = (extra: Partial<LedgerOrder> = {}): LedgerOrder => ({
  _id: ORDER_1,
  store: STORE_A,
  paymentMethod: 'cod',
  status: 'delivered',
  paymentStatus: 'collected',
  subtotal: 2000,
  discountAmount: 0,
  total: 2250,
  ...extra,
});
const card = (extra: Partial<LedgerOrder> = {}): LedgerOrder => ({ ...cod(), _id: ORDER_2, paymentMethod: 'card', status: 'confirmed', paymentStatus: 'paid', ...extra });

// ------------------------------------------------------------------------------------------------------- the formula

test('commissionFor rounds to whole rupees, is never negative and excludes nothing it is given', () => {
  assert.equal(commissionFor(1000, 4), 40);
  assert.equal(commissionFor(1050, 4.5), 47); // 47.25
  assert.equal(commissionFor(10, 5), 1); // 0.5 rounds up, the same way every time
  assert.equal(commissionFor(10, 4.4), 0);
  assert.equal(commissionFor(-500, 4), 0);
  assert.equal(commissionFor(1000, -3), 0);
  assert.equal(commissionFor(0, 4), 0);
  assert.equal(commissionFor(999, 0), 0);
});

test('the base is the item subtotal after discount; delivery is not in it', () => {
  assert.equal(commissionBase({ _id: 1, store: 1, subtotal: 2000, discountAmount: 0, total: 2250 }), 2000);
  assert.equal(commissionBase({ _id: 1, store: 1, subtotal: 2000, discountAmount: 500, total: 1750 }), 1500);
  assert.equal(commissionFor(commissionBase({ _id: 1, store: 1, subtotal: 2000, discountAmount: 500 }), 4), 60);
  assert.equal(commissionBase({ _id: 1, store: 1, subtotal: 100, discountAmount: 500 }), 0);
});

test('the rate is the store custom rate when set, else the platform default, with one decimal', async () => {
  assert.equal(await commissionRateFor({ commissionMode: 'custom', commissionRate: 6.04 }), 6);
  assert.equal(await commissionRateFor({ commissionMode: 'inherit', commissionRate: 9 }), 4);
  assert.equal(await commissionRateFor({ commissionMode: 'custom', commissionRate: 250 }), 4);
  assert.equal(await commissionRateFor(null), 4);
  defaultRate = 5.55;
  assert.equal(await commissionRateFor({}), roundRate(5.55));
});

// -------------------------------------------------------------------------------------------------------------- COD

test('a COD order owes its commission only when BOTH delivered and collected', async () => {
  assert.equal(codCommissionDue(cod({ status: 'dispatched' })), false);
  assert.equal(codCommissionDue(cod({ paymentStatus: 'unpaid' })), false);
  assert.equal(await recordCodCommission(cod({ status: 'dispatched' })), 'not_due');
  assert.equal(await recordCodCommission(cod({ paymentStatus: 'unpaid' })), 'not_due');
  assert.equal(entries.length, 0);
});

test('delivered last or collected last: one cod_commission with the negative balance effect', async () => {
  // collected first, then the delivered transition completes it
  assert.equal(await recordCodCommission(cod({ status: 'delivered', paymentStatus: 'collected' })), 'created');
  // the other order of events ends in the same state, so the same call is the one that writes
  assert.equal(await recordCodCommission(cod({ _id: ORDER_2 })), 'created');
  assert.equal(entries.length, 2);
  const entry = entries[0]!;
  assert.deepEqual([entry.type, entry.balanceEffect, entry.baseAmount, entry.rate, entry.reversesType, entry.settledAt, entry.payoutId], ['cod_commission', -80, 2000, 4, null, null, null]);
});

test('two parallel or repeated calls write one entry (a duplicate key is a success)', async () => {
  const results = await Promise.all([recordCodCommission(cod()), recordCodCommission(cod()), recordCodCommission(cod())]);
  assert.equal(entries.length, 1);
  assert.deepEqual(results.filter((r) => r === 'created').length, 1);
  assert.ok(results.every((r) => r === 'created' || r === 'exists'));
  assert.equal(await recordCodCommission(cod()), 'exists');
  assert.equal(entries.length, 1);
});

test('a rate change after the order does not change the entry', async () => {
  await recordCodCommission(cod());
  storeRate = { commissionMode: 'custom', commissionRate: 10 };
  defaultRate = 9;
  assert.equal(await recordCodCommission(cod()), 'exists');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.rate, 4);
  assert.equal(entries[0]!.balanceEffect, -80);
});

test('a discount lowers the base and the commission; delivery stays out', async () => {
  await recordCodCommission(cod({ subtotal: 2000, discountAmount: 500, total: 1750 }));
  assert.equal(entries[0]!.baseAmount, 1500);
  assert.equal(entries[0]!.balanceEffect, -60);
});

test('a ledger failure writes nothing, never throws and logs no secret', async () => {
  createFails = true;
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(JSON.stringify(args));
  try {
    assert.equal(await recordCodCommission(cod()), 'failed');
    assert.equal(await recordCardEntries(card()), 'failed');
  } finally {
    console.error = original;
  }
  assert.equal(entries.length, 0);
  assert.ok(logged.length >= 1);
  assert.ok(!logged.join('').includes('password'), 'the connection string is not logged');
});

// ------------------------------------------------------------------------------------------------------------- card

test('a paid card order writes card_sale (+total) and card_commission (-commission), once', async () => {
  assert.equal(await recordCardEntries(card({ subtotal: 2000, discountAmount: 200, total: 2050 })), 'ok');
  assert.equal(await recordCardEntries(card({ subtotal: 2000, discountAmount: 200, total: 2050 })), 'ok');
  assert.equal(entries.length, 2);
  const sale = entries.find((e) => e.type === 'card_sale')!;
  const fee = entries.find((e) => e.type === 'card_commission')!;
  assert.equal(sale.balanceEffect, 2050);
  assert.equal(sale.baseAmount, 2050);
  assert.equal(fee.balanceEffect, -72); // 4% of 1800
  assert.equal(fee.baseAmount, 1800);
  assert.equal(await recordCardEntries(card({ paymentStatus: 'unpaid' })), 'not_due');
});

// --------------------------------------------------------------------------------------------------------- reversal

test('a reversal mirrors every original entry with the opposite sign, once only', async () => {
  await recordCardEntries(card());
  const first = await reverseLedgerForOrder(ORDER_2, 'refund');
  assert.deepEqual(first, { written: 2, existing: 0, failed: 0 });
  const reversals = entries.filter((e) => e.type === 'reversal');
  assert.equal(reversals.length, 2);
  const sale = reversals.find((e) => e.reversesType === 'card_sale')!;
  const fee = reversals.find((e) => e.reversesType === 'card_commission')!;
  assert.equal(sale.balanceEffect, -2250);
  assert.equal(fee.balanceEffect, 80);
  assert.equal(audits.filter((a) => a.action === 'commission.reversal').length, 1);

  const again = await reverseLedgerForOrder(ORDER_2, 'refund');
  assert.deepEqual(again, { written: 0, existing: 2, failed: 0 });
  assert.equal(entries.filter((e) => e.type === 'reversal').length, 2);
  // the originals are left as they were (settled or not)
  assert.ok(entries.filter((e) => e.type !== 'reversal').every((e) => e.settledAt === null));
});

test('reversing an order with no entries writes nothing', async () => {
  assert.deepEqual(await reverseLedgerForOrder(ORDER_1, 'x'), { written: 0, existing: 0, failed: 0 });
  assert.equal(entries.length, 0);
});

// ------------------------------------------------------------------------------------------------------- append only

test('the model refuses to change or delete an entry, except the settlement fields', () => {
  const schema = (CommissionEntry as any).schema;
  const index = schema.indexes().find(([, options]: any[]) => options?.unique);
  assert.deepEqual(index[0], { order: 1, type: 1, reversesType: 1 });
  assert.ok(schema.indexes().some(([keys]: any[]) => keys.store === 1 && keys.settledAt === 1));
  assert.doesNotThrow(() => assertSettlementOnlyUpdate({ $set: { settledAt: new Date(), payoutId: '65a0000000000000000b0001' } }));
  for (const update of [{ $set: { balanceEffect: 0 } }, { $set: { rate: 1 } }, { $inc: { baseAmount: 1 } }, { type: 'reversal' }, { $unset: { order: 1 } }]) {
    assert.throws(() => assertSettlementOnlyUpdate(update), /append only/);
  }
});

// ------------------------------------------------------------------------------------------------------------ backfill

const backfillRequest = (secret?: string) =>
  new NextRequest('http://seller.test/api/internal/commission/backfill', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} });

test('the backfill route is closed without the secret, and when none is set', async () => {
  assert.equal((await backfillPOST(backfillRequest())).status, 401);
  process.env.OUTBOX_CRON_SECRET = CRON;
  assert.equal((await backfillPOST(backfillRequest())).status, 401);
  assert.equal((await backfillPOST(backfillRequest('wrong'.repeat(8)))).status, 401);
  delete process.env.OUTBOX_CRON_SECRET;
  assert.equal((await backfillPOST(backfillRequest(CRON))).status, 401);
  assert.equal(entries.length, 0);
});

test('the backfill writes what is missing, with the current rate, and a second run writes nothing', async () => {
  process.env.OUTBOX_CRON_SECRET = CRON;
  aggregateOrders = [cod(), card()];
  defaultRate = 7;
  const res = await backfillPOST(backfillRequest(CRON));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { scanned: 2, written: 2, failed: 0 });
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.rate === 7), 'a backfilled entry uses the rate that applies now');
  assert.deepEqual(await backfillCommission(), { scanned: 0, written: 0, failed: 0 });
  assert.equal(entries.length, 3);
});

// ------------------------------------------------------------------------------------------------- seller read route

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, token: string) => new NextRequest('http://seller.test/api/stores/' + id + '/commission', { headers: { authorization: 'Bearer ' + token } });

function stubStores(): void {
  const rows: Record<string, Record<string, any>> = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, name: 'A', ...storeRate },
    [STORE_B]: { _id: STORE_B, owner: USER_B, name: 'B' },
  };
  const same = (a: unknown, b: unknown) => String(a) === String(b);
  StoreModel.findOne = (filter: any) => chain(() => (rows[String(filter._id)] && same(rows[String(filter._id)]!.owner, filter.owner) ? { ...rows[String(filter._id)] } : null));
  StoreModel.exists = async (filter: any) => (rows[String(filter._id)] && same(rows[String(filter._id)]!.owner, filter.owner) ? { _id: filter._id } : null);
}

test('a seller reads the rate of their own store, and whether it is custom or the default', async () => {
  storeRate = {};
  stubStores();
  let res = await rateGET(get(STORE_A, tokenA), params(STORE_A));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rate: 4, source: 'default' });
  storeRate = { commissionMode: 'custom', commissionRate: 6.5 };
  stubStores();
  res = await rateGET(get(STORE_A, tokenA), params(STORE_A));
  assert.deepEqual(await res.json(), { rate: 6.5, source: 'custom' });
});

test('Seller B and an admin session cannot read the rate of Seller A', async () => {
  stubStores();
  assert.ok([403, 404].includes((await rateGET(get(STORE_A, tokenB), params(STORE_A))).status));
  assert.equal((await rateGET(get(STORE_A, tokenAdmin), params(STORE_A))).status, 403);
  assert.equal((await rateGET(new NextRequest('http://seller.test/x'), params(STORE_A))).status, 401);
});

test('a seller cannot set a rate: the read route has no write method and the store PATCH refuses the field', async () => {
  for (const method of ['PUT', 'POST', 'PATCH', 'DELETE']) assert.equal(rateRoute[method], undefined);
  stubStores();
  const res = await storePATCH(
    new NextRequest('http://seller.test/api/stores/' + STORE_A, {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + tokenA, 'content-type': 'application/json' },
      body: JSON.stringify({ commissionRate: 0, commissionMode: 'custom' }),
    }),
    params(STORE_A),
  );
  assert.equal(res.status, 400);
});
