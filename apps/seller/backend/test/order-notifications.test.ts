import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, NotificationOutbox, Order, SellerAlert, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { databaseReady, sendOrderPlaced, sendOrderStatus } from '@/lib/notifications';

// EP-07.US01.T03/T04/T06: what an order queues. Models are stubbed; no database and no email leaves (the first send
// finds nothing to claim). The unique keys of the real indexes are enforced by the stubs.

const SECRET = 'x'.repeat(40);
const OWNER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const ORDER_ID = '65a0000000000000000a0001';

const OutboxModel = NotificationOutbox as any;
const AlertModel = SellerAlert as any;
const StoreModel = Store as any;
const UserModel = User as any;
const OrderModel = Order as any;
const AuditModel = AuditLog as any;

let outbox: Array<Record<string, any>> = [];
let sellerAlerts: Array<Record<string, any>> = [];
let owner: Record<string, any> = {};
let orders: Array<Record<string, any>> = [];
let token = '';
let transitionPOST: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let restore: () => void = () => {};

const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const lean = (value: () => unknown) => ({ select: () => ({ lean: async () => value() }), lean: async () => value() });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function order(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    _id: ORDER_ID,
    orderId: 'ORD-ABCD2345',
    store: STORE,
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    customerName: 'Ayesha <b>Khan</b>',
    customerEmail: 'ayesha@example.com',
    phone: '+923001234567',
    city: 'Lahore',
    address: 'House 1, Street 2, Lahore',
    items: [{ productId: 'p1', variantId: 'v1', productTitle: 'Lawn suit', variantTitle: 'Blue', unitPrice: 3500, quantity: 2 }],
    subtotal: 7000,
    deliveryCharges: 250,
    total: 7250,
    statusHistory: [],
    createdAt: new Date('2026-11-14T08:00:00Z'),
    updatedAt: new Date('2026-11-14T08:00:00Z'),
    ...overrides,
  };
}

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: OWNER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  transitionPOST = (await import('../src/app/api/orders/[id]/transition/route')).POST;
});

beforeEach(() => {
  const saved = {
    connect: (mongoose as any).connect,
    outbox: Object.fromEntries(['create', 'findOne', 'findOneAndUpdate'].map((m) => [m, OutboxModel[m]])),
    alertCreate: AlertModel.create,
    storeFindById: StoreModel.findById,
    storeExists: StoreModel.exists,
    userFindById: UserModel.findById,
    orderFindOne: OrderModel.findOne,
    orderUpdate: OrderModel.findOneAndUpdate,
    auditCreate: AuditModel.create,
    env: { STOREFRONT_URL: process.env.STOREFRONT_URL, APP_BASE_URL_SELLER: process.env.APP_BASE_URL_SELLER, EMAIL_PROVIDER: process.env.EMAIL_PROVIDER },
  };
  outbox = [];
  sellerAlerts = [];
  owner = { _id: OWNER, email: 'seller@example.com', notificationPrefs: { emailNewOrder: true, emailLowStock: true } };
  orders = [order()];
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
  // The first send claims nothing, so the provider is never asked.
  OutboxModel.findOneAndUpdate = () => lean(() => null);
  AlertModel.create = async (doc: Record<string, any>) => {
    if (sellerAlerts.some((a) => a.open && a.store === doc.store && a.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    sellerAlerts.push(row);
    return row;
  };
  StoreModel.findById = () => lean(() => ({ _id: STORE, name: 'Zara Lawn', slug: 'zara', owner: OWNER }));
  StoreModel.exists = async (filter: any) => (String(filter._id) === STORE && String(filter.owner) === OWNER ? { _id: STORE } : null);
  UserModel.findById = (id: string) => lean(() => (String(id) === OWNER ? owner : null));
  OrderModel.findOne = (filter: any) => lean(() => {
    const row = orders.find((o) => String(o._id) === String(filter._id) && String(o.store) === String(filter.store));
    return row ? { ...row } : null;
  });
  OrderModel.findOneAndUpdate = (filter: any, update: any) => lean(() => {
    const row = orders.find((o) => String(o._id) === String(filter._id) && String(o.store) === String(filter.store) && o.status === filter.status);
    if (!row) return null;
    Object.assign(row, update.$set ?? {});
    row.statusHistory = [...row.statusHistory, update.$push?.statusHistory].filter(Boolean);
    return { ...row };
  });
  AuditModel.create = async () => ({ _id: new mongoose.Types.ObjectId() });

  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.outbox)) OutboxModel[m] = fn;
    AlertModel.create = saved.alertCreate;
    StoreModel.findById = saved.storeFindById;
    StoreModel.exists = saved.storeExists;
    UserModel.findById = saved.userFindById;
    OrderModel.findOne = saved.orderFindOne;
    OrderModel.findOneAndUpdate = saved.orderUpdate;
    AuditModel.create = saved.auditCreate;
    for (const [key, value] of Object.entries(saved.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete (mongoose.connection as unknown as Record<string, unknown>).readyState;
  };
});

afterEach(() => restore());

const templates = () => outbox.map((r) => r.template).sort();

test('a new order queues the customer email, the seller email and one seller alert', async () => {
  await sendOrderPlaced(STORE, order());
  assert.deepEqual(templates(), ['order_placed_customer', 'order_placed_seller']);
  const customer = outbox.find((r) => r.template === 'order_placed_customer')!;
  assert.equal(customer.to, 'ayesha@example.com');
  assert.equal(customer.dedupeKey, 'order_placed_customer:' + ORDER_ID + ':email');
  assert.equal(customer.status, 'queued');
  assert.ok(customer.bodyText.includes('https://zara.markazify.com/track?order=ORD-ABCD2345'));
  assert.ok(customer.bodyText.includes('Rs. 7,250'));
  assert.equal(customer.bodyHtml.includes('<b>Khan</b>'), false, 'the customer name is escaped in HTML');
  const seller = outbox.find((r) => r.template === 'order_placed_seller')!;
  assert.equal(seller.to, 'seller@example.com');
  assert.ok(seller.bodyText.includes('https://seller.markazify.com/s/' + STORE + '/orders/' + ORDER_ID));
  assert.equal(sellerAlerts.length, 1);
  assert.equal(sellerAlerts[0]!.kind, 'new_order');
  assert.equal(sellerAlerts[0]!.link, '/orders/' + ORDER_ID);
});

test('the same order announced twice queues nothing new', async () => {
  await sendOrderPlaced(STORE, order());
  await sendOrderPlaced(STORE, order());
  assert.equal(outbox.length, 2);
  assert.equal(sellerAlerts.length, 1);
});

test('no customer email: the customer message is skipped, the seller is still told', async () => {
  await sendOrderPlaced(STORE, order({ customerEmail: null }));
  assert.deepEqual(templates(), ['order_placed_seller']);
  assert.equal(sellerAlerts.length, 1);
});

test('a seller who switched new-order emails off still gets the in-app alert', async () => {
  owner.notificationPrefs = { emailNewOrder: false, emailLowStock: true };
  await sendOrderPlaced(STORE, order());
  assert.deepEqual(templates(), ['order_placed_customer']);
  assert.equal(sellerAlerts.length, 1);
});

test('a failing outbox never throws to the caller', async () => {
  OutboxModel.create = async () => {
    throw new Error('database down');
  };
  const errors = console.error;
  console.error = () => {};
  try {
    await sendOrderPlaced(STORE, order());
  } finally {
    console.error = errors;
  }
  assert.equal(sellerAlerts.length, 1, 'the alert is still written');
});

test('each status queues one customer email; processing has none; a repeat queues nothing', async () => {
  await sendOrderStatus(STORE, order({ status: 'confirmed' }), 'confirmed');
  await sendOrderStatus(STORE, order({ status: 'confirmed' }), 'confirmed');
  await sendOrderStatus(STORE, order({ status: 'processing' }), 'processing');
  await sendOrderStatus(STORE, order({ status: 'dispatched', courier: 'TCS', trackingNumber: 'TCS-1001' }), 'dispatched');
  await sendOrderStatus(STORE, order({ status: 'delivered' }), 'delivered');
  assert.deepEqual(templates(), ['order_confirmed', 'order_delivered', 'order_dispatched']);
  assert.equal(outbox.find((r) => r.template === 'order_confirmed')!.dedupeKey, 'order_confirmed:' + ORDER_ID);
  assert.ok(outbox.find((r) => r.template === 'order_dispatched')!.bodyText.includes('TCS-1001'));
});

test('a status email without a customer email is skipped', async () => {
  await sendOrderStatus(STORE, order({ status: 'cancelled', customerEmail: '' }), 'cancelled');
  assert.equal(outbox.length, 0);
});

test('nothing runs while the database connection is not open (the stubbed unit tests elsewhere)', () => {
  assert.equal(databaseReady(), false);
});

test('a repeated and a parallel transition email the customer once: only the winner of the compare-and-set queues it', async () => {
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true, writable: true });
  const call = () =>
    transitionPOST(
      new NextRequest('http://seller.test/api/orders/' + ORDER_ID + '/transition', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-store-id': STORE },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: Promise.resolve({ id: ORDER_ID }) },
    );

  const [first, second] = await Promise.all([call(), call()]);
  const third = await call();
  await settle();

  const changed = await Promise.all([first, second, third].map(async (r) => ((await r.json()) as { changed: boolean }).changed));
  assert.deepEqual(changed.filter(Boolean).length, 1, 'one request moved the order');
  assert.deepEqual(templates(), ['order_confirmed']);
});
