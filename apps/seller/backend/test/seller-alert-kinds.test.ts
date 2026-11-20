import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import * as dbNs from '@markaz/db-schemas';
import type { SellerAlertKind } from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { SELLER_ALERT_KINDS } from '@/lib/contracts';
import { NotificationOutbox, SellerAlert, Store, User } from '@/lib/services';
import { sendOrderPlaced, type NewSellerAlert } from '@/lib/notifications';
import { toAlertWire } from '@/lib/seller-alerts';

// Sprint 5 EP-11 (D-108): the seller alert kinds live in FOUR places. This file fails when one of them is missed:
//   1. packages/db-schemas  models/seller-alert.ts   SELLER_ALERT_KINDS   (what the model accepts)
//   2. packages/contracts   notifications.ts         SELLER_ALERT_KINDS   (what the dashboard reads)
//   3. apps/seller/backend  lib/seller-alerts.ts     KINDS                (an unknown kind there silently becomes new_order)
//   4. apps/seller/backend  lib/notifications.ts     NewSellerAlert.kind  (what a writer may ask for)
// Adding a kind to one place and not the others is exactly what these tests catch.

const db = unwrapCjs(dbNs) as typeof dbNs;
const MODEL_KINDS: readonly string[] = db.SELLER_ALERT_KINDS;
const CONTRACT_KINDS: readonly string[] = SELLER_ALERT_KINDS;

test('the model and the contracts list the same kinds, in the same order', () => {
  assert.deepEqual([...MODEL_KINDS], [...CONTRACT_KINDS]);
});

test('the kinds of Sprint 5 are there: unconfirmed_order (SB-2) and return_requested (SB-3) next to the three of Sprint 4', () => {
  for (const kind of ['new_order', 'low_stock', 'out_of_stock', 'unconfirmed_order', 'return_requested']) {
    assert.ok(MODEL_KINDS.includes(kind), 'model ' + kind);
    assert.ok(CONTRACT_KINDS.includes(kind), 'contracts ' + kind);
  }
});

test('the model accepts every kind of the contracts, and refuses one that is not listed', () => {
  const base = { store: '65a000000000000000000011', title: 'T', body: '', open: true };
  for (const kind of CONTRACT_KINDS) assert.equal(new (SellerAlert as any)({ ...base, kind }).validateSync(), undefined, kind);
  assert.ok(new (SellerAlert as any)({ ...base, kind: 'review_received' }).validateSync()?.errors.kind, 'a kind nobody listed (yet) is refused');
});

test('the alert wire keeps every kind; only a kind nobody listed becomes new_order (the silent fallback this test guards)', () => {
  for (const kind of CONTRACT_KINDS) assert.equal(toAlertWire({ _id: 'x', kind, title: 't', body: 'b', createdAt: new Date() }).kind, kind, kind);
  assert.equal(toAlertWire({ _id: 'x', kind: 'nonsense', title: 't', body: 'b', createdAt: new Date() }).kind, 'new_order');
});

test('NewSellerAlert accepts every kind of the contracts (a compile-time check: tsc fails when the type misses one)', () => {
  const alerts: NewSellerAlert[] = (SELLER_ALERT_KINDS as readonly SellerAlertKind[]).map((kind) => ({
    store: '65a000000000000000000011',
    kind,
    title: 'T',
    body: 'B',
    link: null,
    dedupeKey: 'k:' + kind,
  }));
  assert.equal(alerts.length, CONTRACT_KINDS.length);
  const unconfirmed: NewSellerAlert['kind'] = 'unconfirmed_order';
  assert.equal(unconfirmed, 'unconfirmed_order');
});

// ---------------------------------------------------------------------------------------------------------------------
// What an order writes

const OWNER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const ORDER_ID = '65a0000000000000000a0001';

const OutboxModel = NotificationOutbox as any;
const AlertModel = SellerAlert as any;
const StoreModel = Store as any;
const UserModel = User as any;

let outbox: Array<Record<string, any>> = [];
let alerts: Array<Record<string, any>> = [];
let restore: () => void = () => {};

const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const lean = (value: () => unknown) => ({ select: () => ({ lean: async () => value() }), lean: async () => value() });

function order(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    _id: ORDER_ID,
    orderId: 'ORD-ABCD2345',
    store: STORE,
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    customerName: 'Ayesha Khan',
    customerEmail: 'ayesha@example.com',
    phone: '+923001234567',
    city: 'Lahore',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Lawn suit', variantTitle: 'Blue', unitPrice: 3500, quantity: 2 }],
    subtotal: 7000,
    deliveryCharges: 250,
    total: 7250,
    statusHistory: [],
    createdAt: new Date('2026-11-14T08:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    outbox: Object.fromEntries(['create', 'findOne', 'findOneAndUpdate'].map((m) => [m, OutboxModel[m]])),
    alertCreate: AlertModel.create,
    storeFindById: StoreModel.findById,
    userFindById: UserModel.findById,
    env: { STOREFRONT_URL: process.env.STOREFRONT_URL, APP_BASE_URL_SELLER: process.env.APP_BASE_URL_SELLER, EMAIL_PROVIDER: process.env.EMAIL_PROVIDER },
  };
  outbox = [];
  alerts = [];
  process.env.STOREFRONT_URL = 'https://markazify.com';
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  delete process.env.EMAIL_PROVIDER;
  (mongoose as any).connect = async () => mongoose;
  OutboxModel.create = async (doc: Record<string, any>) => {
    if (doc.dedupeKey !== undefined && outbox.some((r) => r.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    outbox.push(row);
    return row;
  };
  OutboxModel.findOne = (filter: any) => lean(() => outbox.find((r) => r.dedupeKey === filter.dedupeKey) ?? null);
  OutboxModel.findOneAndUpdate = () => lean(() => null);
  AlertModel.create = async (doc: Record<string, any>) => {
    if (alerts.some((a) => a.open && a.store === doc.store && a.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    alerts.push(row);
    return row;
  };
  StoreModel.findById = () => lean(() => ({ _id: STORE, name: 'Zara Lawn', slug: 'zara', owner: OWNER }));
  UserModel.findById = (id: string) =>
    lean(() => (String(id) === OWNER ? { _id: OWNER, role: 'seller', email: 'seller@example.com', notificationPrefs: { emailNewOrder: true, emailLowStock: true } } : null));
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.outbox)) OutboxModel[m] = fn;
    AlertModel.create = saved.alertCreate;
    StoreModel.findById = saved.storeFindById;
    UserModel.findById = saved.userFindById;
    for (const [key, value] of Object.entries(saved.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
});

afterEach(() => restore());

test('an unconfirmed COD order raises ONE bell alert, of the new kind, linking to the order', async () => {
  await sendOrderPlaced(STORE, order({ confirmationStatus: 'unconfirmed', riskFlags: ['high_value'] }));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, 'unconfirmed_order');
  assert.match(alerts[0]!.title, /ORD-ABCD2345/);
  assert.match(alerts[0]!.title, /confirmation/);
  assert.equal(alerts[0]!.link, '/orders/' + ORDER_ID);
  assert.equal(String(alerts[0]!.order), ORDER_ID);
  // The alert reaches the bell as the new kind, not as a new order.
  assert.equal(toAlertWire(alerts[0]).kind, 'unconfirmed_order');
  // The seller's email is still sent: the alert replaces the bell entry, not the email.
  assert.ok(outbox.some((row) => row.template === 'order_placed_seller'));
});

test('a repeat of the same order alerts once (the same open key), and the kinds never double up', async () => {
  const placed = order({ confirmationStatus: 'unconfirmed' });
  await sendOrderPlaced(STORE, placed);
  await sendOrderPlaced(STORE, placed);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.dedupeKey, 'neworder:' + ORDER_ID);
});

test('an order that needs no confirmation (none, not_required, confirmed) raises the ordinary new_order alert, as before', async () => {
  for (const [index, confirmationStatus] of [undefined, 'not_required', 'confirmed'].entries()) {
    alerts = [];
    outbox = [];
    await sendOrderPlaced(STORE, order({ _id: '65a0000000000000000a01' + String(index).padStart(2, '0'), ...(confirmationStatus === undefined ? {} : { confirmationStatus }) }));
    assert.equal(alerts.length, 1, String(confirmationStatus));
    assert.equal(alerts[0]!.kind, 'new_order', String(confirmationStatus));
    assert.match(alerts[0]!.title, /^New order /);
  }
});

test('a return request raises ONE bell alert of the return_requested kind, which reaches the bell as that kind and not as new_order', async () => {
  const { sendReturnRequested } = await import('@/lib/notifications');
  await sendReturnRequested(STORE, { _id: '65a0000000000000000e0001', returnNumber: 'RET-7KQ4M2XA', order: ORDER_ID }, order());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, 'return_requested');
  assert.equal(alerts[0]!.dedupeKey, 'return:65a0000000000000000e0001:requested');
  assert.equal(toAlertWire(alerts[0]).kind, 'return_requested');
  assert.match(alerts[0]!.title, /RET-7KQ4M2XA/);
  // The same return announced twice: nothing new.
  await sendReturnRequested(STORE, { _id: '65a0000000000000000e0001', returnNumber: 'RET-7KQ4M2XA', order: ORDER_ID }, order());
  assert.equal(alerts.length, 1);
  assert.equal(outbox.filter((row) => row.template === 'return_requested_seller').length, 1);
});
