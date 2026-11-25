import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { PREVIEW_CREDENTIAL_HEADER } from '@markaz/platform-kit/preview';
import { signedClientAddressHeaders } from '@markaz/platform-kit/signed-client-address';
import { DailyStat, Product, ProductDailyStat, Store } from '@/lib/services';
import { EVENT_LIMIT, resetRateLimits } from '../src/lib/storefront/rate-limit';
import { productViewsFor, recordOrderStat, statExpiry, withViewCounts } from '../src/lib/storefront-stats';
import { TTL_RETENTION_DAYS } from '../src/lib/retention-policy';
import * as contractsNs from '@markaz/contracts';
import * as dbNs from '@markaz/db-schemas';
import { unwrapCjs } from '@/lib/cjs';

// Sprint 8 (S8-B6, D-118): the public counter endpoint and the counter library. Models are in memory; no database.

const { STAT_RETENTION_DAYS, PRODUCT_STAT_SLUGS_PER_DAY } = unwrapCjs(contractsNs) as typeof contractsNs;
const { STAT_MODEL_RETENTION_DAYS } = unwrapCjs(dbNs) as typeof dbNs;

const STORE = '65a000000000000000000011';
const OTHER = '65a000000000000000000012';
const ADDRESS_SECRET = 's'.repeat(40);

type Row = Record<string, any>;
let daily: Row[];
let perProduct: Row[];
let stores: Row[];
let products: Row[];
let fail: boolean;
let restore: () => void = () => {};
let POST: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.CLIENT_ADDRESS_SIGNING_SECRET = ADDRESS_SECRET;
  POST = (await import('../src/app/api/storefront/v1/events/route')).POST;
});

const matches = (row: Row, filter: Row): boolean =>
  Object.entries(filter).every(([key, wanted]) => {
    if (wanted === null) return row[key] === null || row[key] === undefined;
    if (typeof wanted === 'object' && '$ne' in wanted) return row[key] !== wanted.$ne;
    return String(row[key]) === String(wanted);
  });

function upsert(rows: Row[]) {
  return async (filter: Row, change: Row, options: Row = {}) => {
    if (fail) throw new Error('database down');
    let row = rows.find((r) => matches(r, filter));
    const matched = row ? 1 : 0;
    if (!row) {
      if (!options.upsert) return { matchedCount: 0 };
      row = { ...filter, ...(change.$setOnInsert ?? {}) };
      rows.push(row);
    }
    for (const [field, by] of Object.entries(change.$inc ?? {})) row[field] = (row[field] ?? 0) + (by as number);
    return { matchedCount: matched };
  };
}

beforeEach(() => {
  resetRateLimits();
  daily = [];
  perProduct = [];
  fail = false;
  stores = [{ _id: STORE, status: 'active' }, { _id: OTHER, status: 'pending' }];
  products = [
    { _id: 'p1', store: STORE, slug: 'lawn-suit', isPublished: true, deletedAt: null, moderation: null },
    { _id: 'p2', store: STORE, slug: 'draft', isPublished: false, deletedAt: null, moderation: null },
  ];
  const D = DailyStat as any;
  const P = ProductDailyStat as any;
  const S = Store as any;
  const Pr = Product as any;
  const saved = { connect: (mongoose as any).connect, d: D.updateOne, pu: P.updateOne, pc: P.countDocuments, pa: P.aggregate, s: S.findById, pe: Pr.exists };
  (mongoose as any).connect = async () => mongoose;
  D.updateOne = upsert(daily);
  P.updateOne = upsert(perProduct);
  P.countDocuments = async (filter: Row) => perProduct.filter((r) => matches(r, filter)).length;
  P.aggregate = async (pipeline: any[]) => {
    const { store, day } = pipeline[0].$match;
    const sums = new Map<string, number>();
    for (const row of perProduct) {
      if (String(row.store) !== String(store) || row.day < day.$gte || row.day > day.$lte) continue;
      sums.set(row.productSlug, (sums.get(row.productSlug) ?? 0) + row.views);
    }
    return [...sums].map(([slug, views]) => ({ _id: slug, views })).sort((a, b) => b.views - a.views);
  };
  S.findById = (id: unknown) => ({ select: () => ({ lean: async () => stores.find((s) => s._id === String(id)) ?? null }) });
  Pr.exists = async (filter: Row) => (products.some((p) => matches(p, filter)) ? { _id: 'x' } : null);
  restore = () => {
    (mongoose as any).connect = saved.connect;
    D.updateOne = saved.d;
    P.updateOne = saved.pu;
    P.countDocuments = saved.pc;
    P.aggregate = saved.pa;
    S.findById = saved.s;
    Pr.exists = saved.pe;
  };
});
afterEach(() => restore());

function send(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new NextRequest('http://seller.test/api/storefront/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}
const today = () => new Date().toISOString().slice(0, 10);

test('each event adds one to its counter of the store and the UTC day, with an expiry 400 days on', async () => {
  for (const event of ['page_view', 'add_to_cart', 'add_to_cart', 'checkout_start']) {
    const res = await send({ store: STORE, event });
    assert.equal(res.status, 200, event);
    assert.deepEqual(await res.json(), { data: { received: true } });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('set-cookie'), null, 'no cookie is ever set');
  }
  assert.equal(daily.length, 1);
  const row = daily[0]!;
  assert.deepEqual([row.store, row.day, row.visits, row.addToCart, row.checkoutStarts, row.productViews], [STORE, today(), 1, 2, 1, undefined]);
  assert.equal(row.expiresAt.getTime(), statExpiry(today()).getTime());
  assert.deepEqual(Object.keys(row).sort(), ['addToCart', 'checkoutStarts', 'day', 'expiresAt', 'store', 'visits'], 'nothing about the visitor');
});

test('a product view counts the store and the product; a slug that is no live product of the store is ignored', async () => {
  assert.equal((await send({ store: STORE, event: 'product_view', productSlug: 'lawn-suit' })).status, 200);
  assert.equal((await send({ store: STORE, event: 'product_view', productSlug: 'lawn-suit' })).status, 200);
  for (const productSlug of ['draft', 'no-such-product']) assert.equal((await send({ store: STORE, event: 'product_view', productSlug })).status, 200);
  assert.equal(daily[0]!.productViews, 2);
  assert.deepEqual(perProduct.map((r) => [r.productSlug, r.views]), [['lawn-suit', 2]]);
});

test('at most 500 different products per store and day get a counter; a known one keeps counting and the day total keeps counting', async () => {
  assert.equal(PRODUCT_STAT_SLUGS_PER_DAY, 500);
  for (let i = 0; i < PRODUCT_STAT_SLUGS_PER_DAY; i += 1) perProduct.push({ store: STORE, productSlug: 'x' + i, day: today(), views: 1 });
  await send({ store: STORE, event: 'product_view', productSlug: 'lawn-suit' });
  assert.equal(perProduct.length, 500);
  assert.equal(daily[0]!.productViews, 1);
  perProduct[0]!.productSlug = 'lawn-suit';
  await send({ store: STORE, event: 'product_view', productSlug: 'lawn-suit' });
  assert.equal(perProduct[0]!.views, 2);
});

test('a bad event, an unknown key, a missing or misplaced product slug and a bad body are 400 and count nothing', async () => {
  const bad: unknown[] = [
    { store: STORE, event: 'purchase' },
    { store: STORE, event: 'page_view', visitorId: 'abc' },
    { store: STORE, event: 'page_view', productSlug: 'lawn-suit' },
    { store: STORE, event: 'product_view' },
    { store: 'nope', event: 'page_view' },
    { event: 'page_view' },
    'not json',
  ];
  for (const body of bad) assert.equal((await send(body)).status, 400, JSON.stringify(body));
  assert.equal(daily.length, 0);
});

test('an unknown store is 404 and a store that is not live is 403', async () => {
  assert.equal((await send({ store: '65a0000000000000000000ff', event: 'page_view' })).status, 404);
  assert.equal((await send({ store: OTHER, event: 'page_view' })).status, 403);
  assert.equal(daily.length, 0);
});

test('a preview is never counted', async () => {
  const res = await send({ store: STORE, event: 'page_view' }, { [PREVIEW_CREDENTIAL_HEADER]: 'anything' });
  assert.equal(res.status, 200);
  assert.equal(daily.length, 0);
});

test('success is said only after the write: a failed write is 503', async () => {
  fail = true;
  const res = await send({ store: STORE, event: 'page_view' });
  assert.equal(res.status, 503);
});

test('a flood from one address to one store is 429 with Retry-After; another address and another store are free', async () => {
  const from = (ip: string, store = STORE) => signedClientAddressHeaders(ADDRESS_SECRET, store, ip) as Record<string, string>;
  for (let i = 0; i < EVENT_LIMIT.limit; i += 1) assert.equal((await send({ store: STORE, event: 'page_view' }, from('203.0.113.7'))).status, 200, String(i));
  const flooded = await send({ store: STORE, event: 'page_view' }, from('203.0.113.7'));
  assert.equal(flooded.status, 429);
  assert.ok(flooded.headers.get('retry-after'));
  assert.equal((await send({ store: STORE, event: 'page_view' }, from('203.0.113.8'))).status, 200);
  assert.equal(daily[0]!.visits, EVENT_LIMIT.limit + 1);
});

test('orders are counted by the server, and a failing count never throws', async () => {
  await recordOrderStat(STORE, new Date('2026-11-25T23:59:00.000Z'));
  await recordOrderStat(STORE, new Date('2026-11-26T00:01:00.000Z'));
  assert.deepEqual(daily.map((r) => [r.day, r.orders]), [['2026-11-25', 1], ['2026-11-26', 1]]);
  fail = true;
  const saved = console.error;
  console.error = () => {};
  try {
    await recordOrderStat(STORE);
  } finally {
    console.error = saved;
  }
});

test('order creation counts a new order once, after the replay returns', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'lib', 'storefront', 'order-service.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal((source.match(/countOrder\(storeId\)/g) ?? []).length, 1);
  assert.match(source, /countOrder\(storeId\);\n\s*return \{ order, replayed: false \};/);
});

test('product views are read from the per-product counters, summed over the range, for this store only', async () => {
  perProduct.push(
    { store: STORE, productSlug: 'a', day: '2026-11-01', views: 2 },
    { store: STORE, productSlug: 'a', day: '2026-11-02', views: 3 },
    { store: STORE, productSlug: 'b', day: '2026-11-02', views: 9 },
    { store: STORE, productSlug: 'a', day: '2026-10-31', views: 100 },
    { store: OTHER, productSlug: 'a', day: '2026-11-02', views: 100 },
  );
  const range = { from: '2026-11-01', to: '2026-11-30' };
  assert.deepEqual(await productViewsFor(STORE, range), [{ productSlug: 'b', views: 9 }, { productSlug: 'a', views: 5 }]);
  const withViews = await withViewCounts(STORE, [{ slug: 'a', title: 'A' }, { slug: 'c', title: 'C' }], range);
  assert.deepEqual(withViews, [{ slug: 'a', title: 'A', viewCount: 5 }, { slug: 'c', title: 'C', viewCount: 0 }]);
});

test('the retention policy, the contracts and the models agree on 400 days', () => {
  assert.equal(STAT_RETENTION_DAYS, 400);
  assert.equal(STAT_MODEL_RETENTION_DAYS, 400);
  assert.deepEqual(TTL_RETENTION_DAYS, { dailyStats: 400, productDailyStats: 400 });
});
