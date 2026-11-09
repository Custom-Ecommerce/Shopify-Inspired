import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Product, Store } from '@/lib/services';
import { storefrontCartQuoteRequestSchema, storefrontCartQuoteResponseSchema } from '@/lib/contracts';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';

const STORE_ID = '65a000000000000000000021';
const SHIRT = '65a0000000000000000000c1';
const SHIRT_DEFAULT = '65a0000000000000000000e1';
const TOP = '65a0000000000000000000c2';
const TOP_S = '65a0000000000000000000e2';
const TOP_M = '65a0000000000000000000e3';
const DRAFT = '65a0000000000000000000c3';
const DEMO = '65a0000000000000000000c4';
const TRASHED = '65a0000000000000000000c5';

/** The part of a Mongoose query these routes use. */
interface StubQuery {
  select: () => StubQuery;
  lean: () => Promise<unknown>;
}

const stubQuery = (rows: unknown): StubQuery => {
  const query: StubQuery = { select: () => query, lean: async () => rows };
  return query;
};

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const StoreModel = Store as unknown as { findById: () => StubQuery };
const ProductModel = Product as unknown as { find: () => StubQuery };

type RouteContext = { params: Promise<{ id: string }> };

let quotePOST: (request: NextRequest, context: RouteContext) => Promise<Response>;
let productReads: number;
/** When set, the catalog the next quotes read. */
let catalog: unknown[] | null;
let restore: () => void;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  quotePOST = (await import('../src/app/api/storefront/v1/stores/[id]/cart/quote/route')).POST;
});

beforeEach(() => {
  resetRateLimits();
  productReads = 0;
  catalog = null;

  const saved = {
    connect: mongooseStub.connect,
    findById: StoreModel.findById,
    find: ProductModel.find,
  };

  mongooseStub.connect = async () => mongoose;
  StoreModel.findById = () =>
    stubQuery({
      _id: STORE_ID,
      status: 'active',
      storefront: { deliveryRate: 250, freeDeliveryThreshold: 5000 },
      paymentSettings: { codEnabled: true, cardEnabled: false },
    });
  ProductModel.find = () => {
    productReads += 1;
    if (catalog !== null) return stubQuery(catalog);
    return stubQuery([
      { _id: SHIRT, isPublished: true, title: 'Blue shirt', deliveryCharge: null, variants: [{ _id: SHIRT_DEFAULT, title: 'Default', price: 1500, trackQuantity: true, stockQuantity: 10 }] },
      ...[
        { _id: DRAFT, isPublished: false },
        { _id: DEMO, isPublished: true, isDemo: true },
        { _id: TRASHED, isPublished: false, deletedAt: new Date() },
      ].map((flags) => ({ ...flags, title: 'Secret', deliveryCharge: null, variants: [{ _id: SHIRT_DEFAULT, title: 'Default', price: 1, trackQuantity: true, stockQuantity: 10 }] })),
      {
        _id: TOP,
        isPublished: true,
        title: 'Lawn top',
        deliveryCharge: 400,
        variants: [
          { _id: TOP_S, title: 'S', price: 1000, trackQuantity: true, stockQuantity: 0 },
          { _id: TOP_M, title: 'M', price: 1200, trackQuantity: true, stockQuantity: 5 },
        ],
      },
    ]);
  };

  restore = () => {
    mongooseStub.connect = saved.connect;
    StoreModel.findById = saved.findById;
    ProductModel.find = saved.find;
  };
});

afterEach(() => restore());

function post(body: unknown): Promise<Response> {
  const request = new NextRequest('http://localhost/api/storefront/v1/stores/' + STORE_ID + '/cart/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return quotePOST(request, { params: Promise.resolve({ id: STORE_ID }) });
}

test('POST cart/quote loads, refuses a bad body with 400, and prices a valid cart', async () => {
  const bad = await post({ lines: 'not-a-list' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_REQUEST');
  assert.equal(productReads, 0, 'a refused body never reaches the catalog');

  const res = await post({ lines: [{ productId: SHIRT, qty: 2 }] });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const { data } = storefrontCartQuoteResponseSchema.parse(await res.json());
  assert.deepEqual(data.lines, [
    { productId: SHIRT, variantId: SHIRT_DEFAULT, title: 'Blue shirt', variantTitle: 'Default', unitPrice: 1500, qty: 2, lineTotal: 3000, issue: null, availableQty: 10 },
  ]);
  assert.equal(data.subtotal, 3000);
  assert.equal(data.deliveryCharges, 250);
  assert.equal(data.total, 3250);
  assert.equal(data.canCheckout, true);
});

test('a product with several variants and no variantId is a line issue, and the rest of the cart is still shown', async () => {
  const res = await post({ lines: [{ productId: TOP, qty: 1 }, { productId: SHIRT, qty: 2 }] });
  assert.equal(res.status, 200);
  const { data } = storefrontCartQuoteResponseSchema.parse(await res.json());
  assert.deepEqual(data.lines.map((line) => line.issue), ['unknown_variant', null]);
  assert.equal(data.lines[0].title, 'Lawn top');
  assert.equal(data.lines[0].variantId, null);
  assert.equal(data.lines[0].unitPrice, null);
  assert.equal(data.lines[0].lineTotal, null);
  assert.equal(data.subtotal, 3000);
  assert.equal(data.canCheckout, false);
});

test('the variant decides the price, and the delivery override applies to it', async () => {
  const res = await post({ lines: [{ productId: TOP, variantId: TOP_M, qty: 2 }] });
  const { data } = storefrontCartQuoteResponseSchema.parse(await res.json());
  assert.equal(data.lines[0].unitPrice, 1200);
  assert.equal(data.lines[0].variantTitle, 'M');
  assert.equal(data.subtotal, 2400);
  assert.equal(data.deliveryCharges, 400);
  assert.equal(data.canCheckout, true);
});

test('a variant that is sold out, or not of this product, is a line issue and stays out of the totals', async () => {
  const res = await post({
    lines: [
      { productId: TOP, variantId: TOP_S, qty: 1 },
      { productId: TOP, variantId: SHIRT_DEFAULT, qty: 1 },
      { productId: SHIRT, qty: 1 },
    ],
  });
  const { data } = storefrontCartQuoteResponseSchema.parse(await res.json());
  assert.deepEqual(data.lines.map((line) => line.issue), ['out_of_stock', 'unknown_variant', null]);
  assert.equal(data.subtotal, 1500);
  assert.equal(data.canCheckout, false);
});

test('a product with one variant may leave variantId out, and naming it too is one line', async () => {
  const res = await post({ lines: [{ productId: SHIRT, qty: 1 }, { productId: SHIRT, variantId: SHIRT_DEFAULT, qty: 2 }] });
  const { data } = storefrontCartQuoteResponseSchema.parse(await res.json());
  assert.equal(data.lines.length, 1);
  assert.equal(data.lines[0].qty, 3);
  assert.equal(data.lines[0].variantId, SHIRT_DEFAULT);
});

test('a draft, an unedited demo and a trashed product are per-line refusals that block checkout and show nothing (D-037)', async () => {
  const res = await post({ lines: [{ productId: SHIRT, qty: 1 }, { productId: DRAFT, qty: 1 }, { productId: DEMO, qty: 1 }, { productId: TRASHED, qty: 1 }] });
  assert.equal(res.status, 200);
  const { data } = storefrontCartQuoteResponseSchema.parse(await res.json());
  assert.deepEqual(data.lines.map((line) => line.issue), [null, 'product_unavailable', 'product_unavailable', 'product_unavailable']);
  for (const line of data.lines.slice(1)) {
    assert.equal(line.title, null);
    assert.equal(line.unitPrice, null);
  }
  assert.equal(data.subtotal, 1500);
  assert.equal(data.canCheckout, false);
});

/* ------------------------------------------- EP-03 CB-1 ------------------------------------------- */

const TAKEN_DOWN = '65a0000000000000000000c6';
const GONE = '65a0000000000000000000c7';

const shirtAt = (price: number, stockQuantity = 10, deliveryCharge: number | null = null) => ({
  _id: SHIRT,
  isPublished: true,
  title: 'Blue shirt',
  deliveryCharge,
  variants: [{ _id: SHIRT_DEFAULT, title: 'Default', price, trackQuantity: true, stockQuantity }],
});

async function quoted(body: unknown) {
  const res = await post(body);
  assert.equal(res.status, 200);
  return storefrontCartQuoteResponseSchema.parse(await res.json()).data;
}

test('the EP-01 re-export of the quote contract is a real schema at runtime', () => {
  assert.equal(typeof storefrontCartQuoteRequestSchema.safeParse, 'function');
  assert.equal(typeof storefrontCartQuoteResponseSchema.safeParse, 'function');
  assert.equal(storefrontCartQuoteRequestSchema.safeParse({ lines: [{ productId: SHIRT, qty: 1 }] }).success, true);
});

test('the quote carries line prices, subtotal, delivery, a discount of 0 and the total', async () => {
  const res = await post({ lines: [{ productId: SHIRT, qty: 2 }] });
  const raw = (await res.json()) as { data: Record<string, unknown> };
  assert.equal(raw.data.discount, 0, 'the backend sends the field, it is not only defaulted by the reader');
  assert.equal(raw.data.subtotal, 3000);
  assert.equal(raw.data.deliveryCharges, 250);
  assert.equal(raw.data.total, 3250);
});

test('lines of several variants are priced each from its own variant', async () => {
  catalog = [
    {
      _id: TOP,
      isPublished: true,
      title: 'Lawn top',
      deliveryCharge: null,
      variants: [
        { _id: TOP_S, title: 'S', price: 1000, trackQuantity: true, stockQuantity: 5 },
        { _id: TOP_M, title: 'M', price: 1200, trackQuantity: true, stockQuantity: 5 },
      ],
    },
  ];
  const data = await quoted({ lines: [{ productId: TOP, variantId: TOP_S, qty: 1 }, { productId: TOP, variantId: TOP_M, qty: 2 }] });
  assert.deepEqual(data.lines.map((line) => [line.variantTitle, line.unitPrice, line.lineTotal]), [['S', 1000, 1000], ['M', 1200, 2400]]);
  assert.equal(data.subtotal, 3400);
  assert.equal(data.canCheckout, true);
});

test('a variant the seller removed while it sat in the cart is a line error that keeps the product title', async () => {
  const data = await quoted({ lines: [{ productId: SHIRT, variantId: TOP_M, qty: 1 }] });
  assert.equal(data.lines[0].issue, 'unknown_variant');
  assert.equal(data.lines[0].title, 'Blue shirt');
  assert.equal(data.lines[0].unitPrice, null);
  assert.equal(data.lines[0].lineTotal, null);
  assert.equal(data.total, 0);
  assert.equal(data.canCheckout, false);
});

test('a quantity above stock is a line error that says how many are left', async () => {
  catalog = [shirtAt(1500, 3)];
  const data = await quoted({ lines: [{ productId: SHIRT, qty: 4 }] });
  assert.equal(data.lines[0].issue, 'insufficient_stock');
  assert.equal(data.lines[0].availableQty, 3);
  assert.equal(data.lines[0].unitPrice, 1500);
  assert.equal(data.lines[0].lineTotal, null);
  assert.equal(data.subtotal, 0);
  assert.equal(data.canCheckout, false);
});

test('an empty cart is 200 with nothing to pay, and cannot check out', async () => {
  const data = await quoted({ lines: [] });
  assert.deepEqual(data, { lines: [], subtotal: 0, deliveryCharges: 0, discount: 0, total: 0, canCheckout: false });
  assert.equal(productReads, 0, 'an empty cart asks the catalog nothing');
});

test('prices sent by the browser are ignored, wherever they are put', async () => {
  const data = await quoted({
    lines: [{ productId: SHIRT, qty: 1, unitPrice: 1, price: 1, lineTotal: 1, compareAtPrice: 1 }],
    subtotal: 1,
    deliveryCharges: 0,
    discount: 1400,
    total: 1,
  });
  assert.equal(data.lines[0].unitPrice, 1500);
  assert.equal(data.subtotal, 1500);
  assert.equal(data.deliveryCharges, 250);
  assert.equal(data.discount, 0);
  assert.equal(data.total, 1750);
});

test('a price changed after add-to-cart shows the new price in the next quote', async () => {
  const cart = { lines: [{ productId: SHIRT, qty: 2, unitPrice: 1500 }] };
  catalog = [shirtAt(1500)];
  assert.equal((await quoted(cart)).total, 3250);

  catalog = [shirtAt(1800)];
  const after = await quoted(cart);
  assert.equal(after.lines[0].unitPrice, 1800);
  assert.equal(after.lines[0].lineTotal, 3600);
  assert.equal(after.subtotal, 3600);
  assert.equal(after.total, 3850);
});

test('a price change across the free-delivery threshold changes the delivery too', async () => {
  const cart = { lines: [{ productId: SHIRT, qty: 1 }] };
  catalog = [shirtAt(4999)];
  assert.equal((await quoted(cart)).deliveryCharges, 250);
  catalog = [shirtAt(5000)];
  const after = await quoted(cart);
  assert.equal(after.deliveryCharges, 0);
  assert.equal(after.total, 5000);
});

test('a deleted and a taken-down product are per-line errors, never a 500, and the rest of the cart still prices', async () => {
  catalog = [shirtAt(1500), { ...shirtAt(1), _id: TAKEN_DOWN, moderation: { reason: 'counterfeit', at: new Date() } }];
  const res = await post({ lines: [{ productId: SHIRT, qty: 1 }, { productId: TAKEN_DOWN, qty: 1 }, { productId: GONE, qty: 1 }] });
  assert.equal(res.status, 200);
  const { data } = storefrontCartQuoteResponseSchema.parse(await res.json());
  assert.deepEqual(data.lines.map((line) => line.issue), [null, 'product_unavailable', 'unknown_product']);
  for (const line of data.lines.slice(1)) {
    assert.equal(line.title, null, 'a taken-down product shows nothing of itself');
    assert.equal(line.unitPrice, null);
    assert.equal(line.lineTotal, null);
    assert.equal(line.availableQty, null);
  }
  assert.equal(data.subtotal, 1500);
  assert.equal(data.canCheckout, false);
});

test('a line id that could not be a product is a per-line error and never reaches the database', async () => {
  const data = await quoted({ lines: [{ productId: 'not-an-object-id', qty: 1 }] });
  assert.equal(data.lines[0].issue, 'unknown_product');
  assert.equal(productReads, 0);
});

test('older catalog data never turns a quote into a 500', async () => {
  // A price or delivery charge written with decimals before D-004 is rounded, the same way the order rounds it.
  catalog = [shirtAt(1499.5, 10, 150.4)];
  const rounded = await quoted({ lines: [{ productId: SHIRT, qty: 2 }] });
  assert.equal(rounded.lines[0].unitPrice, 1500);
  assert.equal(rounded.subtotal, 3000);
  assert.equal(rounded.deliveryCharges, 150);

  for (const [rows, issue] of [
    [[{ ...shirtAt(1500), variants: undefined }], 'unknown_variant'],
    [[{ ...shirtAt(1500), variants: [] }], 'unknown_variant'],
    [[shirtAt(Number.NaN)], 'unknown_product'],
    [[shirtAt(-5)], 'unknown_product'],
  ] as const) {
    catalog = [...rows];
    const data = await quoted({ lines: [{ productId: SHIRT, qty: 1 }] });
    assert.equal(data.lines[0].issue, issue);
    assert.equal(data.canCheckout, false);
  }
});

test('bad input is a 400 that names the field', async () => {
  for (const [body, code, field] of [
    [{ lines: 'not-a-list' }, 'INVALID_REQUEST', 'lines'],
    [{}, 'INVALID_REQUEST', 'lines'],
    [{ lines: [{ qty: 1 }] }, 'INVALID_REQUEST', 'lines.0.productId'],
    [{ lines: [{ productId: SHIRT, qty: 'two' }] }, 'INVALID_REQUEST', 'lines.0.qty'],
    [{ lines: [{ productId: SHIRT, qty: 0 }] }, 'INVALID_QUANTITY', 'lines.0.qty'],
    [{ lines: [{ productId: SHIRT, qty: 1 }, { productId: TOP, variantId: TOP_M, qty: 1.5 }] }, 'INVALID_QUANTITY', 'lines.1.qty'],
    [{ lines: [{ productId: SHIRT, qty: 100 }] }, 'INVALID_QUANTITY', 'lines.0.qty'],
  ] as const) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const json = (await res.json()) as { error: { code: string }; field: string };
    assert.equal(json.error.code, code, JSON.stringify(body));
    assert.equal(json.field, field, JSON.stringify(body));
  }
  assert.equal(productReads, 0, 'a refused body never reaches the catalog');
});

test('a repeated line that adds up past the limit is refused, as an order refuses it', async () => {
  const res = await post({ lines: [{ productId: SHIRT, qty: 60 }, { productId: SHIRT, qty: 60 }] });
  assert.equal(res.status, 400);
  const json = (await res.json()) as { error: { code: string }; productId: string };
  assert.equal(json.error.code, 'INVALID_QUANTITY');
  assert.equal(json.productId, SHIRT);
});
