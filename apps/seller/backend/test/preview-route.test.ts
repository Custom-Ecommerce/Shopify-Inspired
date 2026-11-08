import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { readPreviewLink } from '@/lib/preview-token';
import { Store, signSession } from '@/lib/services';

const AUTH_SECRET = 'x'.repeat(40);
const PREVIEW_SECRET = 'preview-test-secret-preview-test-secret';

const SELLER_A = '65a000000000000000000001';
const SELLER_B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';

interface StoreRow {
  _id: string;
  owner: string;
  slug: string;
}

interface StubQuery {
  select: () => StubQuery;
  sort: () => StubQuery;
  lean: () => Promise<StoreRow | null>;
}

const STORES: StoreRow[] = [
  { _id: STORE_A, owner: SELLER_A, slug: 'alpha-store' },
  { _id: STORE_B, owner: SELLER_B, slug: 'beta-store' },
];

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const StoreStub = Store as unknown as {
  findById: (id: string) => StubQuery;
  findOne: (filter: { owner: unknown }) => StubQuery;
  exists: (filter: { _id: string; owner: unknown }) => Promise<{ _id: string } | null>;
};

function oneQuery(row: StoreRow | null): StubQuery {
  const query: StubQuery = { select: () => query, sort: () => query, lean: async () => row };
  return query;
}

let POST: (request: NextRequest) => Promise<Response>;
let tokenA: string;
let adminToken: string;
let restore: () => void;

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: SELLER_A, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  adminToken = await signSession({ sub: ADMIN, role: 'admin' }, AUTH_SECRET, SELLER_AUDIENCE);
  POST = (await import('../src/app/api/preview-token/route')).POST;
});

beforeEach(() => {
  const saved = {
    connect: mongooseStub.connect,
    findById: StoreStub.findById,
    findOne: StoreStub.findOne,
    exists: StoreStub.exists,
    secret: process.env.PREVIEW_TOKEN_SECRET,
    url: process.env.STOREFRONT_URL,
  };
  process.env.PREVIEW_TOKEN_SECRET = PREVIEW_SECRET;
  process.env.STOREFRONT_URL = 'http://localhost:3000';
  mongooseStub.connect = async () => mongoose;
  StoreStub.findById = (id) => oneQuery(STORES.find((row) => row._id === id) ?? null);
  StoreStub.findOne = (filter) => oneQuery(STORES.find((row) => row.owner === String(filter.owner)) ?? null);
  StoreStub.exists = async (filter) => {
    const row = STORES.find((candidate) => candidate._id === filter._id && candidate.owner === String(filter.owner));
    return row ? { _id: row._id } : null;
  };
  restore = () => {
    mongooseStub.connect = saved.connect;
    StoreStub.findById = saved.findById;
    StoreStub.findOne = saved.findOne;
    StoreStub.exists = saved.exists;
    if (saved.secret === undefined) delete process.env.PREVIEW_TOKEN_SECRET;
    else process.env.PREVIEW_TOKEN_SECRET = saved.secret;
    if (saved.url === undefined) delete process.env.STOREFRONT_URL;
    else process.env.STOREFRONT_URL = saved.url;
  };
});

afterEach(() => restore());

function call(options: { token?: string; storeId?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  if (options.storeId) headers['x-store-id'] = options.storeId;
  return POST(
    new NextRequest('http://seller.test/api/preview-token', {
      method: 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

test('the owner gets a link on the store host, bound to that store, for 24 hours, and it is not cacheable', async () => {
  const res = await call({ token: tokenA, storeId: STORE_A });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');

  const body = (await res.json()) as { url: string; expiresAt: string };
  const url = new URL(body.url);
  assert.equal(url.host, 'alpha-store.localhost:3000');
  assert.equal(url.protocol, 'http:');
  assert.equal(url.pathname, '/');

  const token = url.searchParams.get('preview');
  assert.deepEqual(await readPreviewLink(token, STORE_A), { ok: true });
  assert.deepEqual(await readPreviewLink(token, STORE_B), { ok: false });
  const hours = (new Date(body.expiresAt).getTime() - Date.now()) / 3_600_000;
  assert.ok(hours > 23.9 && hours <= 24);
});

test('owner A cannot get a link for store B', async () => {
  const res = await call({ token: tokenA, storeId: STORE_B });
  assert.equal(res.status, 403);
});

test('a store id in the body is ignored: the link is for the owned store', async () => {
  const res = await call({ token: tokenA, body: { store: STORE_B, storeId: STORE_B } });
  assert.equal(res.status, 200);
  const { url } = (await res.json()) as { url: string };
  assert.equal(new URL(url).host, 'alpha-store.localhost:3000');
});

test('no session is a 401, and an admin may not preview (D-042)', async () => {
  assert.equal((await call({ storeId: STORE_A })).status, 401);
  assert.equal((await call({ token: adminToken, storeId: STORE_A })).status, 403);
});

test('a missing secret is a 503, and so is a missing storefront address', async () => {
  delete process.env.PREVIEW_TOKEN_SECRET;
  assert.equal((await call({ token: tokenA, storeId: STORE_A })).status, 503);

  process.env.PREVIEW_TOKEN_SECRET = PREVIEW_SECRET;
  delete process.env.STOREFRONT_URL;
  assert.equal((await call({ token: tokenA, storeId: STORE_A })).status, 503);
});
