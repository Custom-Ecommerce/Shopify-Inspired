import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { RateLimitCounter, Product, Store } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { signedClientAddressHeaders } from '@markaz/platform-kit/signed-client-address';
import {
  CART_QUOTE_LIMIT,
  DISCOUNT_CHECK_LIMIT,
  FAVOURITES_LIMIT,
  ORDER_CREATE_LIMIT,
  ORDER_LOOKUP_LIMIT,
  resetRateLimits,
  type RateLimitRule,
} from '../src/lib/storefront/rate-limit';

type Limiter = typeof import('../src/lib/storefront/rate-limit');

const STORE = '65a000000000000000000011';
const RULE: RateLimitRule = { name: 'test', limit: 3, windowMs: 60_000 };
const NOW = 1_800_000_000_000 - (1_800_000_000_000 % 60_000) + 10_000;

/** Each import with its own query is a separate copy of the module: a second backend instance. */
const instance = (name: string): Promise<Limiter> => import('../src/lib/storefront/rate-limit.ts?instance=' + name) as Promise<Limiter>;

interface StubCounter {
  findOneAndUpdate: (filter: { _id: string }, update: Record<string, any>, options: Record<string, unknown>) => { lean: () => Promise<unknown> };
  createIndexes: () => Promise<unknown>;
}
const CounterModel = RateLimitCounter as unknown as StubCounter;
const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };

let counters: Map<string, { count: number; expiresAt: Date }>;
let lastCall: { filter: unknown; update: Record<string, any>; options: Record<string, unknown> } | null;
let indexCalls: number;
let failNext: Array<() => Promise<unknown>>;
let errors: unknown[][];
let restore: () => void;

const hits = () => [...counters.values()].reduce((sum, row) => sum + row.count, 0);
const headersFrom = (values: Record<string, string> = {}) => new Headers(values);
const clientA = headersFrom({ 'x-forwarded-for': '203.0.113.1' });

beforeEach(() => {
  counters = new Map();
  lastCall = null;
  indexCalls = 0;
  failNext = [];
  errors = [];
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.TRUSTED_PROXY_HOPS = '1';
  delete process.env.TRUSTED_CLIENT_IP_HEADER;

  const saved = {
    connect: mongooseStub.connect,
    update: CounterModel.findOneAndUpdate,
    indexes: CounterModel.createIndexes,
    error: console.error,
  };
  mongooseStub.connect = async () => mongoose;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true, writable: true });
  console.error = (...args: unknown[]) => void errors.push(args);
  CounterModel.createIndexes = async () => {
    indexCalls += 1;
  };
  // What MongoDB does for this one document, in one step.
  CounterModel.findOneAndUpdate = (filter, update, options) => ({
    lean: async () => {
      lastCall = { filter, update, options };
      const failure = failNext.shift();
      if (failure) await failure();
      const row = counters.get(filter._id) ?? { count: 0, expiresAt: update.$setOnInsert.expiresAt };
      row.count += update.$inc.count;
      counters.set(filter._id, row);
      return { _id: filter._id, ...row };
    },
  });
  restore = () => {
    mongooseStub.connect = saved.connect;
    CounterModel.findOneAndUpdate = saved.update;
    CounterModel.createIndexes = saved.indexes;
    console.error = saved.error;
    delete (mongoose.connection as unknown as Record<string, unknown>).readyState;
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
  };
});

afterEach(() => restore());

const refusal = async (work: Promise<void>): Promise<StorefrontHttpError> => {
  const err = await work.then(() => null, (caught: unknown) => caught);
  assert.ok(err instanceof StorefrontHttpError, 'expected a 429');
  return err;
};

test('requests up to the limit pass; the next is 429 with the seconds left in the window', async () => {
  const { enforceRateLimit } = await instance('limit');
  for (let i = 0; i < 3; i += 1) await enforceRateLimit(RULE, STORE, clientA, NOW);
  const err = await refusal(enforceRateLimit(RULE, STORE, clientA, NOW));
  assert.equal(err.status, 429);
  assert.equal(err.code, 'RATE_LIMITED');
  assert.equal(err.extra.retryAfterSeconds, 50);
});

test('a new window starts a new count', async () => {
  const { enforceRateLimit } = await instance('reset');
  for (let i = 0; i < 3; i += 1) await enforceRateLimit(RULE, STORE, clientA, NOW);
  await refusal(enforceRateLimit(RULE, STORE, clientA, NOW + 49_000));
  await enforceRateLimit(RULE, STORE, clientA, NOW + 50_000);
});

test('two backend instances add to one count', async () => {
  const first = await instance('one');
  const second = await instance('two');
  assert.notEqual(first.enforceRateLimit, second.enforceRateLimit, 'these must be separate copies of the module');
  await first.enforceRateLimit(RULE, STORE, clientA, NOW);
  await second.enforceRateLimit(RULE, STORE, clientA, NOW);
  await first.enforceRateLimit(RULE, STORE, clientA, NOW);
  await refusal(second.enforceRateLimit(RULE, STORE, clientA, NOW));
  assert.equal(counters.size, 1);
});

test('the count is one atomic upsert, and the document expires after its window', async () => {
  const { enforceRateLimit } = await instance('atomic');
  await enforceRateLimit(RULE, STORE, clientA, NOW);
  assert.ok(lastCall);
  assert.deepEqual(lastCall.update.$inc, { count: 1 });
  assert.equal(lastCall.options.upsert, true);
  assert.equal(lastCall.options.new, true);
  const windowEnd = NOW - 10_000 + 60_000;
  assert.ok(lastCall.update.$setOnInsert.expiresAt.getTime() > windowEnd);
  assert.deepEqual(lastCall.filter, { _id: 'test:' + STORE + ':203.0.113.1:' + (NOW - 10_000) });
});

test('the schema has a TTL index, and the limiter asks for it once', async () => {
  const ttl = RateLimitCounter.schema.indexes().find(([keys]) => 'expiresAt' in keys);
  assert.ok(ttl);
  assert.equal(ttl[1]?.expireAfterSeconds, 0);

  const { enforceRateLimit } = await instance('ttl');
  await enforceRateLimit(RULE, STORE, clientA, NOW);
  await enforceRateLimit(RULE, STORE, clientA, NOW);
  assert.equal(indexCalls, 1);
});

test('two first requests racing on the insert are both counted', async () => {
  const { enforceRateLimit } = await instance('race');
  failNext.push(async () => {
    throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  });
  await enforceRateLimit(RULE, STORE, clientA, NOW);
  assert.equal(hits(), 1);
  assert.equal(errors.length, 0, 'a lost insert is not a store error');
});

test('each rule and each store has its own count', async () => {
  const { enforceRateLimit } = await instance('buckets');
  const other: RateLimitRule = { ...RULE, name: 'other' };
  for (let i = 0; i < 3; i += 1) await enforceRateLimit(RULE, STORE, clientA, NOW);
  await enforceRateLimit(other, STORE, clientA, NOW);
  await enforceRateLimit(RULE, '65a000000000000000000012', clientA, NOW);
});

test('a client inventing x-forwarded-for entries stays one client', async () => {
  const { enforceRateLimit } = await instance('spoof');
  for (let i = 0; i < 3; i += 1) {
    await enforceRateLimit(RULE, STORE, headersFrom({ 'x-forwarded-for': '10.0.0.' + i + ', 203.0.113.9' }), NOW);
  }
  await refusal(enforceRateLimit(RULE, STORE, headersFrom({ 'x-forwarded-for': '10.9.9.9, 203.0.113.9' }), NOW));
  // A different real client still gets through.
  await enforceRateLimit(RULE, STORE, headersFrom({ 'x-forwarded-for': '10.9.9.9, 203.0.113.10' }), NOW);
});

test('with no trusted-proxy setting x-forwarded-for is ignored completely', async () => {
  delete process.env.TRUSTED_PROXY_HOPS;
  const { enforceRateLimit } = await instance('nosetting');
  for (let i = 0; i < 3; i += 1) await enforceRateLimit(RULE, STORE, headersFrom({ 'x-forwarded-for': '198.51.100.' + i }), NOW);
  await refusal(enforceRateLimit(RULE, STORE, headersFrom({ 'x-forwarded-for': '198.51.100.99' }), NOW));
});

test('a named trusted header is used instead, and x-forwarded-for beside it changes nothing', async () => {
  delete process.env.TRUSTED_PROXY_HOPS;
  process.env.TRUSTED_CLIENT_IP_HEADER = 'x-real-ip';
  const { enforceRateLimit } = await instance('named');
  for (let i = 0; i < 3; i += 1) await enforceRateLimit(RULE, STORE, headersFrom({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '10.0.0.' + i }), NOW);
  await refusal(enforceRateLimit(RULE, STORE, headersFrom({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '10.1.1.1' }), NOW));
});

test('a store error lets the customer through and is logged', async () => {
  const { enforceRateLimit } = await instance('down');
  failNext.push(async () => {
    throw new Error('connection reset');
  });
  await enforceRateLimit(RULE, STORE, clientA, NOW);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]?.[0]), /store error/);
  assert.deepEqual(Object.keys(errors[0]?.[1] as object), ['rule', 'storeId', 'message']);
});

test('a database that cannot be reached, or is not open, lets the customer through', async () => {
  const { enforceRateLimit } = await instance('closed');
  Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true, writable: true });
  await enforceRateLimit(RULE, STORE, clientA, NOW);
  assert.equal(hits(), 0);
  assert.equal(errors.length, 1);
});

test('a store that hangs does not hold the customer up for more than a moment', async () => {
  const { enforceRateLimit } = await instance('hang');
  failNext.push(() => new Promise(() => undefined));
  const started = Date.now();
  await enforceRateLimit(RULE, STORE, clientA, NOW);
  assert.ok(Date.now() - started < 1500);
  assert.equal(errors.length, 1);
});

/* ------------------------------------------- the signed address ------------------------------------------- */

const SIGNING_SECRET = 's'.repeat(40);

function signedFor(address: string, at: number = Date.now(), secret: string = SIGNING_SECRET): Headers {
  return new Headers({ 'x-forwarded-for': '10.0.0.1', ...signedClientAddressHeaders(secret, STORE, address, at) });
}

async function withSigningSecret(run: (limiter: Limiter) => Promise<void>, name: string): Promise<void> {
  process.env.CLIENT_ADDRESS_SIGNING_SECRET = SIGNING_SECRET;
  try {
    await run(await instance(name));
  } finally {
    delete process.env.CLIENT_ADDRESS_SIGNING_SECRET;
  }
}

test('a valid signature makes each shopper their own client, whatever x-forwarded-for says', () =>
  withSigningSecret(async ({ enforceRateLimit }) => {
    for (let i = 0; i < 3; i += 1) await enforceRateLimit(RULE, STORE, signedFor('203.0.113.20'), NOW);
    await refusal(enforceRateLimit(RULE, STORE, signedFor('203.0.113.20'), NOW));
    await enforceRateLimit(RULE, STORE, signedFor('203.0.113.21'), NOW);
    assert.ok([...counters.keys()].every((key) => !key.includes('10.0.0.1')));
  }, 'signed-valid'));

test('a forged signature cannot choose an address: it falls to the usual resolver', () =>
  withSigningSecret(async ({ enforceRateLimit }) => {
    for (let i = 0; i < 3; i += 1) await enforceRateLimit(RULE, STORE, signedFor('203.0.113.' + i, Date.now(), 'f'.repeat(40)), NOW);
    await refusal(enforceRateLimit(RULE, STORE, signedFor('203.0.113.99', Date.now(), 'f'.repeat(40)), NOW));
    assert.equal(counters.size, 1);
    assert.ok([...counters.keys()][0]?.includes('10.0.0.1'));
  }, 'signed-forged'));

test('an old or replayed signature falls to the usual resolver', () =>
  withSigningSecret(async ({ enforceRateLimit }) => {
    await enforceRateLimit(RULE, STORE, signedFor('203.0.113.30', Date.now() - 61_000), NOW);
    assert.ok([...counters.keys()][0]?.includes('10.0.0.1'));
  }, 'signed-old'));

test('a request with no signature uses the usual resolver', () =>
  withSigningSecret(async ({ enforceRateLimit }) => {
    await enforceRateLimit(RULE, STORE, headersFrom({ 'x-forwarded-for': '203.0.113.40' }), NOW);
    assert.ok([...counters.keys()][0]?.includes('203.0.113.40'));
  }, 'signed-missing'));

test('with no secret on the backend a signature is ignored', async () => {
  const { enforceRateLimit } = await instance('signed-nosecret');
  await enforceRateLimit(RULE, STORE, signedFor('203.0.113.50'), NOW);
  assert.ok([...counters.keys()][0]?.includes('10.0.0.1'));
});

test('every public route has a limit, and lookup and tracking share one', () => {
  const rules = [CART_QUOTE_LIMIT, ORDER_CREATE_LIMIT, ORDER_LOOKUP_LIMIT, FAVOURITES_LIMIT, DISCOUNT_CHECK_LIMIT];
  assert.equal(new Set(rules.map((rule) => rule.name)).size, rules.length);
  assert.equal(DISCOUNT_CHECK_LIMIT.name, 'discount-check');
  for (const rule of rules) assert.ok(rule.limit > 0 && rule.windowMs > 0);
});

/* ------------------------------------------- the routes ------------------------------------------- */

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

const ROUTES: Array<{ name: string; path: string; method: 'POST' | 'GET'; rule: RateLimitRule; body?: unknown; load: () => Promise<Handler> }> = [
  { name: 'cart quote', path: '/cart/quote', method: 'POST', rule: CART_QUOTE_LIMIT, body: { lines: [] }, load: async () => (await import('../src/app/api/storefront/v1/stores/[id]/cart/quote/route')).POST },
  { name: 'order placement', path: '/orders', method: 'POST', rule: ORDER_CREATE_LIMIT, body: {}, load: async () => (await import('../src/app/api/storefront/v1/stores/[id]/orders/route')).POST },
  { name: 'order lookup', path: '/orders/lookup', method: 'POST', rule: ORDER_LOOKUP_LIMIT, body: {}, load: async () => (await import('../src/app/api/storefront/v1/stores/[id]/orders/lookup/route')).POST },
  { name: 'customer tracking', path: '/orders/track', method: 'POST', rule: ORDER_LOOKUP_LIMIT, body: {}, load: async () => (await import('../src/app/api/storefront/v1/stores/[id]/orders/track/route')).POST },
  { name: 'favourites', path: '/products?ids=65a0000000000000000000b1', method: 'GET', rule: FAVOURITES_LIMIT, load: async () => (await import('../src/app/api/storefront/v1/stores/[id]/products/route')).GET },
];

function call(handler: Handler, route: { path: string; method: string; body?: unknown }, ip: string): Promise<Response> {
  const request = new NextRequest('http://localhost/api/storefront/v1/stores/' + STORE + route.path, {
    method: route.method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
  });
  return handler(request, { params: Promise.resolve({ id: STORE }) });
}

let storeFind: unknown;
before(() => {
  storeFind = (Store as unknown as { findById: unknown }).findById;
  (Store as unknown as { findById: () => unknown }).findById = () => ({ select: () => ({ lean: async () => null }) });
  process.on('exit', () => {
    (Store as unknown as { findById: unknown }).findById = storeFind;
  });
});

for (const route of ROUTES) {
  test(route.name + ': its limit, then 429 with Retry-After, and another client is untouched', async () => {
    resetRateLimits();
    const handler = await route.load();
    for (let i = 0; i < route.rule.limit; i += 1) {
      const res = await call(handler, route, '203.0.113.77');
      assert.notEqual(res.status, 429, 'request ' + i);
    }
    const limited = await call(handler, route, '203.0.113.77');
    assert.equal(limited.status, 429);
    assert.equal(((await limited.json()) as { error: { code: string } }).error.code, 'RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal(limited.headers.get('cache-control'), 'no-store');
    assert.notEqual((await call(handler, route, '203.0.113.78')).status, 429);
  });
}

test('the catalog list is not limited: the storefront server reads it for every shopper', async () => {
  resetRateLimits();
  void Product;
  const handler = (await import('../src/app/api/storefront/v1/stores/[id]/products/route')).GET;
  for (let i = 0; i < FAVOURITES_LIMIT.limit + 5; i += 1) {
    assert.notEqual((await call(handler, { path: '/products', method: 'GET' }, '203.0.113.90')).status, 429);
  }
});

test('order lookup and customer tracking are one count: 10 guesses a minute between them (D-069)', async () => {
  resetRateLimits();
  assert.equal(ORDER_LOOKUP_LIMIT.limit, 10);
  const track = ROUTES.find((route) => route.name === 'customer tracking')!;
  const lookup = ROUTES.find((route) => route.name === 'order lookup')!;
  const [trackHandler, lookupHandler] = [await track.load(), await lookup.load()];
  for (let i = 0; i < 5; i += 1) {
    assert.notEqual((await call(trackHandler, track, '203.0.113.91')).status, 429, 'tracking ' + i);
    assert.notEqual((await call(lookupHandler, lookup, '203.0.113.91')).status, 429, 'lookup ' + i);
  }
  assert.equal((await call(trackHandler, track, '203.0.113.91')).status, 429);
  assert.equal((await call(lookupHandler, lookup, '203.0.113.91')).status, 429);
  assert.notEqual((await call(lookupHandler, lookup, '203.0.113.92')).status, 429, 'another client has its own count');
});
