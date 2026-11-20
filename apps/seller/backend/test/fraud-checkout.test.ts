import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { BlockedContact, Order, Product, Return, StockMovement, Store } from '@/lib/services';
import { storefrontOrderCreatedResponseSchema } from '@/lib/contracts';
import { readFraud } from '@/lib/fraud';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';

// Sprint 5 EP-11 (D-107): the storefront order route with the blocklist and the risk rules. The blocklist is asked right after the method
// checks and BEFORE the order is priced or any stock is taken; the risk rules run on the priced total, still before any stock moves, and
// only set the order's flags and confirmation status: they never reject it. Every model is stubbed in memory (no database).

const STORE_ID = '65a000000000000000000011';
const OTHER_STORE_ID = '65a000000000000000000012';
const SHIRT = '65a0000000000000000000b1';
const SHIRT_VARIANT = SHIRT.slice(0, -2) + 'e' + SHIRT.slice(-1);
const PHONE_KEY = '+923001234567';

const StoreModel = Store as any;
const ProductModel = Product as any;
const OrderModel = Order as any;
const BlockModel = BlockedContact as any;
const ReturnModel = Return as any;
const MovementModel = StockMovement as any;

type Row = Record<string, any>;

let createPOST: (r: NextRequest, c: any) => Promise<Response>;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';
  createPOST = (await import('../src/app/api/storefront/v1/stores/[id]/orders/route')).POST;
});

let storeRow: Row;
let products: Map<string, Row>;
let orders: Row[];
let blocked: Row[];
let movements: Row[];
let productReads: number;
let orderExistsCalls: Row[];
let blockExistsCalls: Row[];
let existsFails: boolean;
/** The store's returns, read by the returns count (lib/returns.ts returnsCountFor). */
let returnRows: Row[];
let restore: () => void;

function activeStore(pay: Row = {}, sf: Row = {}): Row {
  return {
    _id: STORE_ID,
    status: 'active',
    storefront: { deliveryRate: 250, freeDeliveryThreshold: 50000, ...sf },
    paymentSettings: { codEnabled: true, cardEnabled: false, ...pay },
  };
}

const fraud = (codConfirmation: string, riskRules: Row = {}): Row => ({ fraud: { codConfirmation, riskRules } });

beforeEach(() => {
  resetRateLimits();
  storeRow = activeStore();
  products = new Map([
    [
      SHIRT,
      {
        _id: SHIRT,
        store: STORE_ID,
        title: 'Blue shirt',
        isPublished: true,
        variants: [{ _id: SHIRT_VARIANT, title: 'Default', sku: null, price: 1500, trackQuantity: true, stockQuantity: 10, lowStockThreshold: null }],
      },
    ],
  ]);
  orders = [];
  blocked = [];
  movements = [];
  productReads = 0;
  orderExistsCalls = [];
  blockExistsCalls = [];
  existsFails = false;
  returnRows = [];

  const saved = {
    connect: (mongoose as any).connect,
    sFindById: StoreModel.findById,
    pFind: ProductModel.find,
    pFOAU: ProductModel.findOneAndUpdate,
    pExists: ProductModel.exists,
    mCreate: MovementModel.create,
    oFindOne: OrderModel.findOne,
    oCreate: OrderModel.create,
    oExists: OrderModel.exists,
    bExists: BlockModel.exists,
    rCount: ReturnModel.countDocuments,
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findById = () => {
    const q: any = { select: () => q, lean: async () => storeRow };
    return q;
  };
  ProductModel.find = (filter: any) => {
    const q: any = {
      select: () => q,
      lean: async () => {
        productReads += 1;
        return (filter._id.$in as string[]).map((id) => products.get(id.toLowerCase())).filter(Boolean).map((p) => structuredClone(p));
      },
    };
    return q;
  };
  const variantOf = (filter: any): Row | null => {
    const p = products.get(String(filter._id).toLowerCase());
    if (!p) return null;
    const wanted = filter.variants.$elemMatch;
    const variant = p.variants.find((v: Row) => String(v._id).toLowerCase() === String(wanted._id).toLowerCase());
    if (!variant) return null;
    if (wanted.stockQuantity && Number(variant.stockQuantity) < wanted.stockQuantity.$gte) return null;
    return variant;
  };
  ProductModel.findOneAndUpdate = (filter: any, update: any) => {
    const q: any = {
      select: () => q,
      lean: async () => {
        const variant = variantOf(filter);
        if (!variant) return null;
        variant.stockQuantity = Number(variant.stockQuantity) + update.$inc['variants.$.stockQuantity'];
        return { variants: products.get(String(filter._id).toLowerCase())!.variants };
      },
    };
    return q;
  };
  ProductModel.exists = async (filter: any) => variantOf(filter);
  MovementModel.create = async (doc: Row) => {
    movements.push(doc);
    return doc;
  };
  OrderModel.findOne = (filter: any) => ({
    lean: async () => {
      const hit = orders.find((o) => Object.entries(filter).every(([k, v]) => String(o[k]) === String(v)));
      return hit ? structuredClone(hit) : null;
    },
  });
  OrderModel.create = async (doc: any) => {
    await Promise.resolve();
    const now = new Date('2026-11-20T10:00:00.000Z');
    const row = { _id: '65a0000000000000000a' + String(orders.length).padStart(4, '0'), ...structuredClone(doc), createdAt: now, updatedAt: now };
    orders.push(row);
    return row;
  };
  OrderModel.exists = async (filter: any) => {
    orderExistsCalls.push(filter);
    if (existsFails) throw new Error('database hiccup');
    return orders.some((o) => String(o.store) === String(filter.store) && o.phoneKey === filter.phoneKey) ? { _id: 'x' } : null;
  };
  BlockModel.exists = async (filter: any) => {
    blockExistsCalls.push(filter);
    const hit = blocked.find((row) => String(row.store) === String(filter.store) && (filter.$or as Row[]).some((b) => row.kind === b.kind && row.value === b.value));
    return hit ? { _id: 'b' } : null;
  };
  ReturnModel.countDocuments = async (filter: any) =>
    returnRows.filter((row) => String(row.store) === String(filter.store) && row.contactPhone === filter.contactPhone && row.status !== filter.status.$ne).length;
  restore = () => {
    ReturnModel.countDocuments = saved.rCount;
    (mongoose as any).connect = saved.connect;
    StoreModel.findById = saved.sFindById;
    ProductModel.find = saved.pFind;
    ProductModel.findOneAndUpdate = saved.pFOAU;
    ProductModel.exists = saved.pExists;
    MovementModel.create = saved.mCreate;
    OrderModel.findOne = saved.oFindOne;
    OrderModel.create = saved.oCreate;
    OrderModel.exists = saved.oExists;
    BlockModel.exists = saved.bExists;
  };
});

afterEach(() => restore());

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

const CUSTOMER = { customerName: 'Sara Khan', phone: '0300 1234567', address: 'House 12, Street 4, Block 5', city: 'Lahore' };
let keySeq = 0;

function place(body: Row = {}, headers: Row = { 'idempotency-key': 'idem-fraud-' + String(++keySeq).padStart(6, '0') }, id = STORE_ID) {
  return createPOST(
    new NextRequest('http://localhost/api/storefront/v1/stores/' + id + '/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ customer: CUSTOMER, lines: [{ productId: SHIRT, qty: 2 }], ...body }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** An earlier order of the same customer (same phone key), so the new one is not a "new customer". */
function earlierOrder(phoneKey = PHONE_KEY, store = STORE_ID): void {
  orders.push({ _id: '65a0000000000000000a9999', store, orderId: 'ORD-OLD00001', phoneKey, idempotencyKey: 'idem-old-000001', status: 'delivered' });
}

const stock = (): number => products.get(SHIRT)!.variants[0].stockQuantity;
const block = (kind: string, value: string, store = STORE_ID): void => {
  blocked.push({ store, kind, value });
};
const saved = (): Row => orders[orders.length - 1]!;

// ---------------------------------------------------------------------------------------------------------------------
// The blocklist

test('a blocked phone is refused 422 CONTACT_BLOCKED in every spelling, before anything is priced or reserved', async () => {
  block('phone', PHONE_KEY);
  for (const phone of ['0300 1234567', '03001234567', '+923001234567', '+92 300 1234567', '923001234567', '0300-1234567', '00923001234567']) {
    const res = await place({ customer: { ...CUSTOMER, phone } });
    assert.equal(res.status, 422, phone);
    const body = await res.json();
    assert.equal(body.error.code, 'CONTACT_BLOCKED', phone);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal(orders.length, 0, 'no order exists');
  assert.equal(stock(), 10, 'no stock was taken');
  assert.equal(movements.length, 0, 'no stock movement was written');
  assert.equal(productReads, 0, 'the catalog was not even read: nothing was priced');
});

test('the refusal is neutral: it never says the contact is blocked, and carries nothing that identifies the rule', async () => {
  block('phone', PHONE_KEY);
  const res = await place();
  const body = await res.json();
  assert.equal(body.error.message, 'We cannot take this order. Please contact the store.');
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  const text = JSON.stringify(body);
  for (const word of ['blocklist', 'blocked', 'banned', 'fraud', 'risk', 'suspicious']) assert.equal(text.toLowerCase().includes(word.toLowerCase()), false, word);
  // The same words whether it was the phone or the email that matched.
  blocked = [];
  block('email', 'sara@example.pk');
  const byEmail = await (await place({ customer: { ...CUSTOMER, email: 'sara@example.pk' } })).json();
  assert.equal(byEmail.error.message, body.error.message);
});

test('a blocked email is refused whatever its case; a different email and no email are fine', async () => {
  block('email', 'fraud@example.pk');
  for (const email of ['fraud@example.pk', 'FRAUD@Example.PK', ' Fraud@example.pk ']) {
    const res = await place({ customer: { ...CUSTOMER, email } });
    assert.equal(res.status, 422, email);
    assert.equal((await res.json()).error.code, 'CONTACT_BLOCKED');
  }
  assert.equal((await place({ customer: { ...CUSTOMER, email: 'other@example.pk' } })).status, 201);
  assert.equal((await place({ customer: { ...CUSTOMER } })).status, 201);
});

test("a store's blocklist applies to that store only", async () => {
  block('phone', PHONE_KEY, OTHER_STORE_ID);
  assert.equal((await place()).status, 201, "another store's entry does not stop this store's order");
});

test('the blocklist is asked as one indexed question on the store and the normalized contact', async () => {
  await place({ customer: { ...CUSTOMER, email: 'Sara@Example.PK' } });
  assert.equal(blockExistsCalls.length, 1);
  const filter = blockExistsCalls[0]!;
  assert.equal(String(filter.store), STORE_ID);
  assert.deepEqual(filter.$or, [
    { kind: 'phone', value: PHONE_KEY },
    { kind: 'email', value: 'sara@example.pk' },
  ]);
});

test('the method checks come first: a blocked shopper on a store without COD gets the payment error, and a bad body its own 400', async () => {
  block('phone', PHONE_KEY);
  storeRow = activeStore({ codEnabled: false });
  const method = await place();
  assert.equal(method.status, 422);
  assert.equal((await method.json()).error.code, 'PAYMENT_METHOD_UNAVAILABLE');
  assert.equal(blockExistsCalls.length, 0, 'the blocklist was not asked yet');
  storeRow = activeStore();
  assert.equal((await place({ lines: [] })).status, 400);
});

test('a blocked contact is refused even when the order would also be out of stock: nothing is priced', async () => {
  block('phone', PHONE_KEY);
  const res = await place({ lines: [{ productId: SHIRT, qty: 50 }] });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'CONTACT_BLOCKED');
});

// ---------------------------------------------------------------------------------------------------------------------
// The risk rules: modes

test('mode off (the default): no flags, no confirmation, and the rules are not even asked', async () => {
  earlierOrder();
  for (const store of [activeStore(), activeStore(fraud('off', { flagOrderValueAbove: 1, flaggedCities: ['Lahore'] }))]) {
    storeRow = store;
    const res = await place();
    assert.equal(res.status, 201);
    assert.equal('confirmationStatus' in saved(), false);
    assert.equal('riskFlags' in saved(), false);
  }
  assert.equal(orderExistsCalls.length, 0, 'mode off reads nothing');
});

test('mode flagged: an order with no flag is placed with no confirmation; an order with a flag is unconfirmed and keeps its flags', async () => {
  earlierOrder();
  storeRow = activeStore(fraud('flagged', { flagOrderValueAbove: 20000 }));
  assert.equal((await place()).status, 201);
  assert.equal('confirmationStatus' in saved(), false, 'nothing to confirm: it reads as not_required');
  assert.equal('riskFlags' in saved(), false);

  storeRow = activeStore(fraud('flagged', { flagOrderValueAbove: 3000 }));
  const res = await place();
  assert.equal(res.status, 201);
  assert.equal(saved().confirmationStatus, 'unconfirmed');
  assert.deepEqual(saved().riskFlags, ['high_value']);
});

test('mode all: every COD order is unconfirmed, flagged or not', async () => {
  earlierOrder();
  storeRow = activeStore(fraud('all'));
  assert.equal((await place()).status, 201);
  assert.equal(saved().confirmationStatus, 'unconfirmed');
  assert.equal('riskFlags' in saved(), false, 'no rule fired, so there is no flag to show');
});

// ---------------------------------------------------------------------------------------------------------------------
// The rules, one by one

test('high_value compares the priced total (items and delivery): above the amount flags, at the amount does not', async () => {
  earlierOrder();
  // 2 x 1500 = 3000 + 250 delivery = 3250.
  storeRow = activeStore(fraud('flagged', { flagOrderValueAbove: 3250 }));
  await place();
  assert.equal('riskFlags' in saved(), false, 'exactly the total is not above it');
  storeRow = activeStore(fraud('flagged', { flagOrderValueAbove: 3249 }));
  await place();
  assert.deepEqual(saved().riskFlags, ['high_value']);
  assert.equal(saved().total, 3250);
});

test('the client cannot lower the total the rule sees: prices in the request are ignored', async () => {
  earlierOrder();
  storeRow = activeStore(fraud('flagged', { flagOrderValueAbove: 3000 }));
  await place({ lines: [{ productId: SHIRT, qty: 2, price: 1, unitPrice: 1, total: 1 }], total: 1 });
  assert.deepEqual(saved().riskFlags, ['high_value']);
});

test('flagged_city: the shopper\'s free-text city is matched with the shared city matcher', async () => {
  earlierOrder();
  storeRow = activeStore(fraud('flagged', { flaggedCities: ['Karachi', 'Rahim Yar Khan'] }));
  for (const city of ['Karachi', 'karachi', ' KARACHI.', 'rahim yar khan']) {
    await place({ customer: { ...CUSTOMER, city } });
    assert.deepEqual(saved().riskFlags, ['flagged_city'], city);
    assert.equal(saved().confirmationStatus, 'unconfirmed');
  }
  await place({ customer: { ...CUSTOMER, city: 'Lahore' } });
  assert.equal('riskFlags' in saved(), false);
});

test('new_customer: no earlier order with the same phone key; a chip only (D-109): it does not make the order unconfirmed; another store\'s order does not count', async () => {
  storeRow = activeStore(fraud('flagged'));
  await place();
  assert.deepEqual(saved().riskFlags, ['new_customer']);
  assert.equal(saved().confirmationStatus, 'not_required', 'a first-time buyer does not need a call by that alone');
  // The question was one indexed lookup on the store and the normalized phone.
  assert.equal(orderExistsCalls.length, 1);
  assert.equal(String(orderExistsCalls[0]!.store), STORE_ID);
  assert.equal(orderExistsCalls[0]!.phoneKey, PHONE_KEY);

  orders = [];
  earlierOrder(PHONE_KEY, OTHER_STORE_ID);
  await place({ customer: { ...CUSTOMER, phone: '+92 300 1234567' } });
  assert.deepEqual(saved().riskFlags, ['new_customer'], "another store's order is not this store's history");

  orders = [];
  earlierOrder();
  await place({ customer: { ...CUSTOMER, phone: '03001234567' } });
  assert.equal('riskFlags' in saved(), false, 'a returning customer, in any spelling of the phone');
  assert.equal('confirmationStatus' in saved(), false);
});

test('repeat_returns reads the real returns count (D-109, SB-3): at or above the rule flags and makes the order unconfirmed', async () => {
  earlierOrder();
  storeRow = activeStore(fraud('flagged', { flagReturnsAtLeast: 2 }));
  returnRows = [{ store: STORE_ID, contactPhone: PHONE_KEY, status: 'refunded' }];
  assert.equal((await place()).status, 201);
  assert.equal('riskFlags' in saved(), false, 'one return is below the rule');
  returnRows.push({ store: STORE_ID, contactPhone: PHONE_KEY, status: 'requested' });
  assert.equal((await place()).status, 201);
  assert.deepEqual(saved().riskFlags, ['repeat_returns']);
  assert.equal(saved().confirmationStatus, 'unconfirmed', 'an order of a flagged repeat returner waits for the seller\'s call');
});

test('repeat_returns: a rejected return does not count, another customer\'s and another store\'s returns do not count', async () => {
  earlierOrder();
  storeRow = activeStore(fraud('flagged', { flagReturnsAtLeast: 2 }));
  returnRows = [
    { store: STORE_ID, contactPhone: PHONE_KEY, status: 'rejected' },
    { store: STORE_ID, contactPhone: PHONE_KEY, status: 'rejected' },
    { store: STORE_ID, contactPhone: '+923009999999', status: 'refunded' },
    { store: OTHER_STORE_ID, contactPhone: PHONE_KEY, status: 'refunded' },
    { store: STORE_ID, contactPhone: PHONE_KEY, status: 'approved' },
  ];
  assert.equal((await place()).status, 201);
  assert.equal('riskFlags' in saved(), false, 'only one counting return');
});

test('every rule together: all the flags are stored, in order, and the order is still placed', async () => {
  storeRow = activeStore(fraud('flagged', { flagOrderValueAbove: 100, flaggedCities: ['Karachi'], flagReturnsAtLeast: 1 }));
  const res = await place({ customer: { ...CUSTOMER, city: 'Karachi' } });
  assert.equal(res.status, 201);
  assert.deepEqual(saved().riskFlags, ['high_value', 'flagged_city', 'new_customer']);
  assert.equal(saved().confirmationStatus, 'unconfirmed');
});

// ---------------------------------------------------------------------------------------------------------------------
// Flags never reject

test('flags never reject an order: stock is taken, the order is saved, and the storefront answer is the ordinary one', async () => {
  storeRow = activeStore(fraud('all', { flagOrderValueAbove: 1, flaggedCities: ['Lahore'] }));
  const res = await place();
  assert.equal(res.status, 201);
  assert.equal(stock(), 8, 'the 2 units were taken');
  assert.equal(orders.length, 1);
  assert.equal(saved().status, 'pending');
  const body = await res.json();
  assert.equal(storefrontOrderCreatedResponseSchema.safeParse(body).success, true);
  // The shopper is told nothing about confirmation or flags.
  const text = JSON.stringify(body);
  for (const word of ['confirmationStatus', 'riskFlags', 'unconfirmed', 'high_value', 'new_customer']) assert.equal(text.includes(word), false, word);
});

test('a failed risk lookup never loses the order: it is placed and left unconfirmed for the seller to call', async () => {
  storeRow = activeStore(fraud('flagged'));
  existsFails = true;
  const original = console.error;
  console.error = () => {};
  try {
    const res = await place();
    assert.equal(res.status, 201);
  } finally {
    console.error = original;
  }
  assert.equal(saved().confirmationStatus, 'unconfirmed');
  assert.equal('riskFlags' in saved(), false);
  assert.equal(stock(), 8);
});

test('a retry with the same key returns the first order and does not ask the rules again', async () => {
  storeRow = activeStore(fraud('flagged'));
  const headers = { 'idempotency-key': 'idem-fraud-replay-1' };
  assert.equal((await place({}, headers)).status, 201);
  const asked = orderExistsCalls.length;
  const again = await place({}, headers);
  assert.equal(again.status, 200);
  assert.equal(orders.length, 1);
  assert.equal(orderExistsCalls.length, asked);
  assert.equal(stock(), 8);
});

// ---------------------------------------------------------------------------------------------------------------------
// Reading the settings

test('the store settings are read from paymentSettings; anything odd reads as the defaults', () => {
  assert.deepEqual(readFraud(undefined), { codConfirmation: 'off', riskRules: { flagOrderValueAbove: null, flaggedCities: [], flagReturnsAtLeast: null } });
  assert.deepEqual(readFraud({ fraud: 'nonsense' }), readFraud(undefined));
  const odd = readFraud({
    fraud: { codConfirmation: 'banana', riskRules: { flagOrderValueAbove: -5, flaggedCities: ['karachi', 'Atlantis', 'Karachi', 7], flagReturnsAtLeast: 99 } },
  });
  assert.equal(odd.codConfirmation, 'off');
  assert.equal(odd.riskRules.flagOrderValueAbove, null);
  assert.deepEqual(odd.riskRules.flaggedCities, ['Karachi']);
  assert.equal(odd.riskRules.flagReturnsAtLeast, null);
  const good = readFraud({ fraud: { codConfirmation: 'all', riskRules: { flagOrderValueAbove: 15000.4, flagReturnsAtLeast: 2 } } });
  assert.equal(good.codConfirmation, 'all');
  assert.equal(good.riskRules.flagOrderValueAbove, 15000);
  assert.equal(good.riskRules.flagReturnsAtLeast, 2);
});
