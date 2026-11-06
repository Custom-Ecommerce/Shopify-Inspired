import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { assertCan, signSession, User, StoreArticle, Order } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

const SECRET = 'x'.repeat(40);
const USER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const ART_PUB = '65a0000000000000000000e1';
const ART_OTHER = '65a0000000000000000000e2';

const ArticleModel = StoreArticle as any;
const OrderModel = Order as any;
const UserModel = User as any;

let articles: Array<Record<string, any>> = [];
let orders: Array<Record<string, any>> = [];
let token = '';

let articlesGET: (request: NextRequest) => Promise<Response>;
let articleItem: { GET: (r: NextRequest, c: any) => Promise<Response> };
let analyticsGET: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: USER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  articlesGET = (await import('../src/app/api/storeArticles/route')).GET;
  articleItem = (await import('../src/app/api/storeArticles/[id]/route')) as any;
  analyticsGET = (await import('../src/app/api/analytics/route')).GET;
});

function query(rows: unknown[], single = false) {
  const q: any = {
    sort: () => q,
    skip: () => q,
    limit: () => q,
    select: () => q,
    lean: async () => (single ? rows[0] ?? null : rows),
  };
  return q;
}

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
}

function installStubs(): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    aFind: ArticleModel.find,
    aCount: ArticleModel.countDocuments,
    aFindOne: ArticleModel.findOne,
    oFind: OrderModel.find,
    uFindById: UserModel.findById,
  };
  (mongoose as any).connect = async () => mongoose;
  ArticleModel.find = (filter: any) => query(articles.filter((r) => matches(r, filter)));
  ArticleModel.countDocuments = async (filter: any) => articles.filter((r) => matches(r, filter)).length;
  ArticleModel.findOne = (filter: any) => query(articles.filter((r) => matches(r, filter)), true);
  OrderModel.find = (filter: any) => query(orders.filter((r) => matches(r, filter)));
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ store: STORE }) }) });
  return () => {
    (mongoose as any).connect = originals.connect;
    ArticleModel.find = originals.aFind;
    ArticleModel.countDocuments = originals.aCount;
    ArticleModel.findOne = originals.aFindOne;
    OrderModel.find = originals.oFind;
    UserModel.findById = originals.uFindById;
  };
}

function daysAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n, 12, 0, 0));
}

function seed() {
  articles = [
    { _id: ART_PUB, store: STORE, title: 'Care guide', slug: 'care', type: 'care_instructions', status: 'published', excerpt: 'How to wash', createdAt: daysAgo(3), updatedAt: daysAgo(3) },
    { _id: ART_OTHER, store: OTHER_STORE, title: 'Other', slug: 'other', type: 'blog', status: 'draft', createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  ];
  orders = [
    { store: STORE, orderId: 'A', status: 'delivered', city: 'Karachi', total: 2600, createdAt: daysAgo(0), items: [{ productId: 'p1', productTitle: 'Shirt', unitPrice: 1200, quantity: 2 }] },
    { store: STORE, orderId: 'B', status: 'pending', city: 'Lahore', total: 1400, createdAt: daysAgo(2), items: [{ productId: 'p1', productTitle: 'Shirt', unitPrice: 1200, quantity: 1 }] },
    { store: STORE, orderId: 'C', status: 'cancelled', city: 'Karachi', total: 900, createdAt: daysAgo(2), items: [{ productId: 'p2', productTitle: 'Cap', unitPrice: 900, quantity: 1 }] },
    { store: STORE, orderId: 'D', status: 'delivered', city: 'Karachi', total: 800, createdAt: daysAgo(40), items: [{ productId: 'p2', productTitle: 'Cap', unitPrice: 800, quantity: 1 }] },
    { store: OTHER_STORE, orderId: 'E', status: 'delivered', city: 'Multan', total: 5000, createdAt: daysAgo(0), items: [] },
  ];
}

function authed(url: string, bearer = token): NextRequest {
  return new NextRequest(url, { method: 'GET', headers: { authorization: 'Bearer ' + bearer } });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

test('articles require a session: no token is refused with 401', async () => {
  const response = await articlesGET(new NextRequest('http://seller.test/api/storeArticles'));
  assert.equal(response.status, 401);
});

test('the article list returns only the seller store, in the list envelope', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await articlesGET(authed('http://seller.test/api/storeArticles'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { docs: Array<Record<string, unknown>>; totalDocs: number };
    assert.equal(body.totalDocs, 1);
    assert.equal(body.docs[0].id, ART_PUB);
    assert.equal(body.docs[0].type, 'care_instructions');
  } finally {
    restore();
  }
});

test('an unknown article type filter is refused with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await articlesGET(authed('http://seller.test/api/storeArticles?type=news'));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test("another store's article answers 404 and its contents are not returned", async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await articleItem.GET(authed('http://seller.test/api/storeArticles/' + ART_OTHER), params(ART_OTHER));
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes('Other'), false);
  } finally {
    restore();
  }
});

test('analytics refuses an unknown period with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await analyticsGET(authed('http://seller.test/api/analytics?period=1y'));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('analytics counts only the store, excludes cancelled from totals, and keeps cancelled in the status breakdown', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await analyticsGET(authed('http://seller.test/api/analytics?period=7d'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, any>;
    assert.equal(body.period, '7d');
    assert.equal(body.totalOrders, 2);
    assert.equal(body.ordersByStatus.cancelled, 1);
    assert.equal(body.ordersByStatus.delivered, 1);
    assert.equal(body.avgOrderValue, Math.round((2600 + 1400) / 2));
  } finally {
    restore();
  }
});

test('analytics: revenue excludes cancelled orders, the daily series fills the period, and an order outside it is left out', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await analyticsGET(authed('http://seller.test/api/analytics?period=7d'));
    const body = (await response.json()) as { revenue: { daily: Array<{ date: string; amount: number }> } };
    assert.equal(body.revenue.daily.length, 7);
    const total = body.revenue.daily.reduce((sum, day) => sum + day.amount, 0);
    assert.equal(total, 2600 + 1400);
  } finally {
    restore();
  }
});

test('analytics ranks products by revenue and cities by orders, from the store only', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await analyticsGET(authed('http://seller.test/api/analytics?period=30d'));
    const body = (await response.json()) as { topProducts: Array<{ id: string; revenue: number; orders: number }>; topCities: Array<{ city: string; orders: number }> };
    assert.equal(body.topProducts[0].id, 'p1');
    assert.equal(body.topProducts[0].revenue, 2400 + 1200);
    assert.equal(body.topProducts[0].orders, 2);
    assert.equal(body.topCities.some((c) => c.city === 'Multan'), false);
  } finally {
    restore();
  }
});

test('the policy: sellers read articles and orders, and cannot write them', () => {
  assert.doesNotThrow(() => assertCan('seller', 'read', 'storeArticles'));
  assert.doesNotThrow(() => assertCan('seller', 'read', 'orders'));
  assert.throws(() => assertCan('seller', 'create', 'storeArticles'));
  assert.throws(() => assertCan('seller', 'update', 'orders', ['status']));
});
