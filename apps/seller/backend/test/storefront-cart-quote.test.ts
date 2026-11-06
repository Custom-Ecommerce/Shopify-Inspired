import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Product, Store } from '@/lib/services';
import { storefrontCartQuoteResponseSchema } from '@/lib/contracts';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';

const STORE_ID = '65a000000000000000000021';
const SHIRT = '65a0000000000000000000c1';
const SHIRT_DEFAULT = '65a0000000000000000000e1';
const TOP = '65a0000000000000000000c2';
const TOP_S = '65a0000000000000000000e2';
const TOP_M = '65a0000000000000000000e3';

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
let restore: () => void;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  quotePOST = (await import('../src/app/api/storefront/v1/stores/[id]/cart/quote/route')).POST;
});

beforeEach(() => {
  resetRateLimits();
  productReads = 0;

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
    return stubQuery([
      { _id: SHIRT, title: 'Blue shirt', deliveryCharge: null, variants: [{ _id: SHIRT_DEFAULT, title: 'Default', price: 1500, trackQuantity: true, stockQuantity: 10 }] },
      {
        _id: TOP,
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

test('a product with several variants needs a variantId: 422 VARIANT_REQUIRED naming the product', async () => {
  const res = await post({ lines: [{ productId: TOP, qty: 1 }] });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error: { code: string }; productId: string };
  assert.equal(body.error.code, 'VARIANT_REQUIRED');
  assert.equal(body.productId, TOP);
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
