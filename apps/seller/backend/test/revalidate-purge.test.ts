import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildSyncHeaders, computeDataHash } from '@markaz/platform-kit/hmac';
import { Order, Product, StockMovement, Store, AuditLog } from '@/lib/services';
import { revalidateStore, revalidateStoreCategories, revalidateStoreProduct, settleRevalidations } from '../src/lib/revalidate';
import { placeOrder } from '../src/lib/storefront/order-service';
import { restoreOrderStock } from '../src/lib/order-stock';
import { restoreModeratedProduct, takedownProduct } from '../src/lib/moderation';
import type { ParsedOrderRequest } from '../src/lib/storefront/order-request';

const STORE = '65a000000000000000000011';
const PRODUCT = '65a0000000000000000000b1';
const PRODUCT_2 = '65a0000000000000000000b2';
const VARIANT = '65a0000000000000000000e1';
const VARIANT_2 = '65a0000000000000000000e2';
const SLUG = 'blue-shirt';
const SECRET = 'purge-secret-value';

const PRODUCT_TAGS = ['store:' + STORE + ':product:' + SLUG, 'store:' + STORE + ':products', 'store:' + STORE + ':categories'];

type Any = Record<string, any>;
const ProductStub = Product as unknown as Any;
const StoreStub = Store as unknown as Any;
const OrderStub = Order as unknown as Any;
const MovementStub = StockMovement as unknown as Any;
const AuditStub = AuditLog as unknown as Any;

const chain = (value: unknown): Any => {
  const query: Any = { select: () => query, lean: async () => value };
  return query;
};

let sent: Array<{ url: string; headers: Headers; tags: string[] }>;
let fetchBehaviour: () => Promise<Response>;
let errors: unknown[][];
let storeRow: unknown;
let slugs: Map<string, string>;
let restore: () => void;

beforeEach(() => {
  sent = [];
  errors = [];
  storeRow = { slug: 'alpha-store', internalHandle: 'alpha-1' };
  slugs = new Map([[PRODUCT, SLUG]]);
  fetchBehaviour = async () => new Response('{}', { status: 200 });
  process.env.STOREFRONT_URL = 'http://storefront.test';
  process.env.REVALIDATE_SECRET = SECRET;

  const saved = { fetch: globalThis.fetch, error: console.error, productFindById: ProductStub.findById, storeFindById: StoreStub.findById };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init.headers), tags: JSON.parse(String(init.body)).tags });
    return fetchBehaviour();
  }) as typeof fetch;
  console.error = (...args: unknown[]) => void errors.push(args);
  ProductStub.findById = (id: string) => chain(slugs.has(id) ? { slug: slugs.get(id) } : null);
  StoreStub.findById = () => chain(storeRow);
  restore = () => {
    globalThis.fetch = saved.fetch;
    console.error = saved.error;
    ProductStub.findById = saved.productFindById;
    StoreStub.findById = saved.storeFindById;
    delete process.env.STOREFRONT_URL;
    delete process.env.REVALIDATE_SECRET;
  };
});

afterEach(() => restore());

const purged = async (): Promise<string[][]> => {
  await settleRevalidations();
  return sent.map((call) => call.tags);
};

/* ------------------------------------------- the helper ------------------------------------------- */

test('a product change purges its page, the product list and the category list', async () => {
  revalidateStoreProduct(STORE, PRODUCT);
  assert.deepEqual(await purged(), [PRODUCT_TAGS]);
});

test('the secret goes in the header and never in the URL', async () => {
  revalidateStoreProduct(STORE, PRODUCT);
  await settleRevalidations();
  assert.equal(sent[0]?.url, 'http://storefront.test/api/revalidate');
  assert.equal(sent[0]?.headers.get('x-revalidate-secret'), SECRET);
});

test('a product that no longer exists still purges the lists its page was tagged with', async () => {
  revalidateStoreProduct(STORE, PRODUCT_2);
  assert.deepEqual(await purged(), [PRODUCT_TAGS.slice(1)]);
});

test('a product that cannot be read still purges the lists, and the failure is logged', async () => {
  ProductStub.findById = () => {
    throw new Error('read failed');
  };
  revalidateStoreProduct(STORE, PRODUCT);
  assert.deepEqual(await purged(), [PRODUCT_TAGS.slice(1)]);
  assert.equal(errors.length, 1);
});

test('a category change purges the category list and the product list', async () => {
  revalidateStoreCategories(STORE);
  assert.deepEqual(await purged(), [['store:' + STORE + ':categories', 'store:' + STORE + ':products']]);
});

test('a store change purges its settings, its static tag and every key it is fetched by', async () => {
  revalidateStore(STORE);
  assert.deepEqual(await purged(), [['store:' + STORE + ':settings', 'store:' + STORE + ':static', 'store-resolve:alpha-store', 'store-resolve:alpha-1']]);
});

test('a store key the allow-list would refuse is left out, so it cannot sink the whole purge', async () => {
  storeRow = { slug: 'alpha-store', internalHandle: 'Bad Handle!' };
  revalidateStore(STORE);
  assert.deepEqual(await purged(), [['store:' + STORE + ':settings', 'store:' + STORE + ':static', 'store-resolve:alpha-store']]);
});

test('with the storefront not configured nothing is read or sent', async () => {
  delete process.env.STOREFRONT_URL;
  ProductStub.findById = () => {
    throw new Error('must not be read');
  };
  revalidateStoreProduct(STORE, PRODUCT);
  assert.deepEqual(await purged(), []);
  assert.equal(errors.length, 0);
});

test('an unreachable storefront fails nothing and is logged', async () => {
  fetchBehaviour = async () => {
    throw new TypeError('fetch failed');
  };
  assert.doesNotThrow(() => revalidateStoreProduct(STORE, PRODUCT));
  await settleRevalidations();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]?.[0]), /revalidation failed/);
});

test('a refused purge is logged and the secret is not', async () => {
  fetchBehaviour = async () => new Response('{}', { status: 401 });
  revalidateStoreProduct(STORE, PRODUCT);
  await settleRevalidations();
  assert.equal(errors.length, 1);
  assert.equal(JSON.stringify(errors).includes(SECRET), false);
});

test('the caller does not wait for the storefront', async () => {
  let release = (): void => undefined;
  fetchBehaviour = () => new Promise((resolve) => (release = () => resolve(new Response('{}'))));
  const before = Date.now();
  const answer = revalidateStoreProduct(STORE, PRODUCT);
  assert.equal(answer, undefined);
  assert.ok(Date.now() - before < 100);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await settleRevalidations();
});

/* ------------------------------------------- order placement ------------------------------------------- */

const commerce = { id: STORE, deliveryRate: 250, freeDeliveryThreshold: null, codEnabled: true, cardEnabled: false };

const request = (overrides: Partial<ParsedOrderRequest> = {}): ParsedOrderRequest => ({
  idempotencyKey: 'purge-test-key-1',
  fingerprint: 'f',
  customer: { customerName: 'Sara', phone: '+923001234567', address: 'House 12, Street 4', city: 'Karachi', email: null, note: null },
  paymentMethod: 'cod',
  lines: [{ productId: PRODUCT, variantId: VARIANT, qty: 1 }],
  ...overrides,
});

function stubCheckout(stockBefore: number, options: { tracked?: boolean; existing?: unknown; saveFails?: boolean } = {}): () => void {
  const tracked = options.tracked ?? true;
  let stock = stockBefore;
  const saved = { orderFind: OrderStub.findOne, create: OrderStub.create, find: ProductStub.find, update: ProductStub.findOneAndUpdate, exists: ProductStub.exists, movement: MovementStub.create };
  OrderStub.findOne = () => ({ lean: async () => options.existing ?? null });
  OrderStub.create = async (doc: Any) => {
    if (options.saveFails) throw new Error('save failed');
    return doc;
  };
  ProductStub.find = () =>
    chain([{ _id: PRODUCT, isPublished: true, title: 'Shirt', variants: [{ _id: VARIANT, title: 'Default', price: 1000, trackQuantity: tracked, stockQuantity: stock }] }]);
  ProductStub.findOneAndUpdate = (_filter: Any, update: Any) => {
    if (!tracked) return chain(null);
    stock += update.$inc['variants.$.stockQuantity'];
    return chain({ variants: [{ _id: VARIANT, stockQuantity: stock }] });
  };
  ProductStub.exists = async () => ({ _id: PRODUCT });
  MovementStub.create = async () => ({});
  return () => {
    OrderStub.findOne = saved.orderFind;
    OrderStub.create = saved.create;
    ProductStub.find = saved.find;
    ProductStub.findOneAndUpdate = saved.update;
    ProductStub.exists = saved.exists;
    MovementStub.create = saved.movement;
  };
}

test('an order that takes the last unit purges the product', async () => {
  const undo = stubCheckout(1);
  try {
    await placeOrder(STORE, commerce, request());
    assert.deepEqual(await purged(), [PRODUCT_TAGS]);
  } finally {
    undo();
  }
});

test('an order that leaves stock behind purges nothing', async () => {
  const undo = stubCheckout(5);
  try {
    await placeOrder(STORE, commerce, request());
    assert.deepEqual(await purged(), []);
  } finally {
    undo();
  }
});

test('an order for a variant that does not track stock purges nothing', async () => {
  const undo = stubCheckout(0, { tracked: false });
  try {
    await placeOrder(STORE, commerce, request());
    assert.deepEqual(await purged(), []);
  } finally {
    undo();
  }
});

test('an order that fails to save purges nothing: its stock went back', async () => {
  const undo = stubCheckout(1, { saveFails: true });
  try {
    await assert.rejects(placeOrder(STORE, commerce, request()));
    assert.deepEqual(await purged(), []);
  } finally {
    undo();
  }
});

test('a replayed order purges nothing: no stock moved', async () => {
  const undo = stubCheckout(1, { existing: { orderId: 'ORD-1', requestFingerprint: 'f' } });
  try {
    const { replayed } = await placeOrder(STORE, commerce, request());
    assert.equal(replayed, true);
    assert.deepEqual(await purged(), []);
  } finally {
    undo();
  }
});

test('an unreachable storefront does not fail the order', async () => {
  fetchBehaviour = async () => {
    throw new TypeError('fetch failed');
  };
  const undo = stubCheckout(1);
  try {
    const { replayed } = await placeOrder(STORE, commerce, request());
    assert.equal(replayed, false);
    await settleRevalidations();
    assert.equal(errors.length, 1);
  } finally {
    undo();
  }
});

/* ------------------------------------------- cancel ------------------------------------------- */

function stubRestore(after: Record<string, number>): () => void {
  const saved = { update: ProductStub.findOneAndUpdate, movement: MovementStub.create };
  ProductStub.findOneAndUpdate = (filter: Any) => chain({ variants: [{ _id: filter.variants.$elemMatch._id, stockQuantity: after[filter.variants.$elemMatch._id] }] });
  MovementStub.create = async () => ({});
  return () => {
    ProductStub.findOneAndUpdate = saved.update;
    MovementStub.create = saved.movement;
  };
}

const restoreLine = (productId: string, variantId: string, quantity: number) => ({ productId, variantId, quantity, productTitle: 'Shirt', variantTitle: 'Default', stockDeducted: true });

test('a cancel that brings a variant back from zero purges the product', async () => {
  const undo = stubRestore({ [VARIANT]: 2 });
  try {
    await restoreOrderStock(STORE, 'order-1', 'actor', [restoreLine(PRODUCT, VARIANT, 2)]);
    assert.deepEqual(await purged(), [PRODUCT_TAGS]);
  } finally {
    undo();
  }
});

test('a cancel on a variant that still had stock purges nothing', async () => {
  const undo = stubRestore({ [VARIANT]: 5 });
  try {
    await restoreOrderStock(STORE, 'order-1', 'actor', [restoreLine(PRODUCT, VARIANT, 2)]);
    assert.deepEqual(await purged(), []);
  } finally {
    undo();
  }
});

test('two lines of one product coming back from zero purge it once', async () => {
  const undo = stubRestore({ [VARIANT]: 1, [VARIANT_2]: 1 });
  try {
    await restoreOrderStock(STORE, 'order-1', 'actor', [restoreLine(PRODUCT, VARIANT, 1), restoreLine(PRODUCT, VARIANT_2, 1)]);
    assert.deepEqual(await purged(), [PRODUCT_TAGS]);
  } finally {
    undo();
  }
});

/* ------------------------------------------- admin ------------------------------------------- */

function stubModeration(row: Any): () => void {
  const saved = { findOne: ProductStub.findOne, update: ProductStub.findOneAndUpdate, audit: AuditStub.create, connect: (mongoose as any).connect };
  ProductStub.findOne = () => chain(row);
  ProductStub.findOneAndUpdate = () => chain(row);
  AuditStub.create = async () => ({ _id: 'a' });
  return () => {
    ProductStub.findOne = saved.findOne;
    ProductStub.findOneAndUpdate = saved.update;
    AuditStub.create = saved.audit;
  };
}

const moderatedRow = (moderation: unknown): Any => ({
  _id: PRODUCT,
  store: STORE,
  title: 'Shirt',
  slug: SLUG,
  minPrice: 1000,
  isPublished: true,
  isDemo: false,
  deletedAt: null,
  deletedBy: null,
  moderation,
  media: [],
  variants: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

test('an admin takedown purges the product', async () => {
  const undo = stubModeration(moderatedRow(null));
  try {
    await takedownProduct({ productId: PRODUCT, reason: 'counterfeit goods' }, 'admin-1').catch(() => undefined);
    assert.deepEqual(await purged(), [PRODUCT_TAGS]);
  } finally {
    undo();
  }
});

test('an admin restore purges the product', async () => {
  const undo = stubModeration(moderatedRow({ state: 'takedown', reason: 'x', takenDownBy: 'a', takenDownAt: new Date(0) }));
  try {
    await restoreModeratedProduct({ productId: PRODUCT }, 'admin-1').catch(() => undefined);
    assert.deepEqual(await purged(), [PRODUCT_TAGS]);
  } finally {
    undo();
  }
});

/* ------------------------------------------- sync receive ------------------------------------------- */

const SYNC_SECRET = 'x'.repeat(40);

function signedBatch(data: Any, revision = 2): Request {
  const envelope = {
    schemaVersion: 1,
    eventId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    source: 'admin',
    entity: 'store',
    entityId: STORE,
    group: 'governance',
    revision,
    occurredAt: '2026-10-01T00:00:00.000Z',
    op: 'upsert',
    data,
    dataHash: computeDataHash(data),
  };
  const body = JSON.stringify({ envelopes: [envelope] });
  return new Request('http://seller.test/api/internal/sync/receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildSyncHeaders({ keyId: 'k', secret: SYNC_SECRET, rawBody: body }) },
    body,
  });
}

function stubSync(storedRevision: number | undefined, matched: number): () => void {
  process.env.SYNC_KEY_ID_CURRENT = 'k';
  process.env.SYNC_SECRET_CURRENT = SYNC_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  const saved = { connect: (mongoose as any).connect, update: StoreStub.updateOne, exists: StoreStub.exists };
  (mongoose as any).connect = async () => mongoose;
  StoreStub.findById = () => chain({ slug: 'alpha-store', internalHandle: 'alpha-1', ...(storedRevision === undefined ? {} : { govRevision: storedRevision, governanceRevision: storedRevision }) });
  StoreStub.updateOne = async () => ({ matchedCount: matched });
  StoreStub.exists = async () => ({ _id: STORE });
  return () => {
    (mongoose as any).connect = saved.connect;
    StoreStub.updateOne = saved.update;
    StoreStub.exists = saved.exists;
    delete process.env.SYNC_KEY_ID_CURRENT;
    delete process.env.SYNC_SECRET_CURRENT;
  };
}

const STORE_TAGS = ['store:' + STORE + ':settings', 'store:' + STORE + ':static', 'store-resolve:alpha-store', 'store-resolve:alpha-1'];

test('an admin store status change arriving through sync purges the store', async () => {
  const undo = stubSync(undefined, 1);
  try {
    const { POST } = await import('../src/app/api/internal/sync/receive/route');
    const response = await POST(signedBatch({ status: 'suspended' }));
    const result = (await response.json()) as { results: Array<{ outcome: string }> };
    assert.equal(result.results[0]?.outcome, 'applied');
    assert.deepEqual(await purged(), [STORE_TAGS]);
  } finally {
    undo();
  }
});

test('a sync event that lost to a newer revision purges nothing', async () => {
  const undo = stubSync(undefined, 0);
  try {
    const { POST } = await import('../src/app/api/internal/sync/receive/route');
    const response = await POST(signedBatch({ status: 'suspended' }));
    const result = (await response.json()) as { results: Array<{ outcome: string }> };
    assert.equal(result.results[0]?.outcome, 'stale');
    assert.deepEqual(await purged(), []);
  } finally {
    undo();
  }
});

test('an unreachable storefront does not fail the sync', async () => {
  fetchBehaviour = async () => {
    throw new TypeError('fetch failed');
  };
  const undo = stubSync(undefined, 1);
  try {
    const { POST } = await import('../src/app/api/internal/sync/receive/route');
    assert.equal((await POST(signedBatch({ status: 'active' }))).status, 200);
    await settleRevalidations();
    assert.equal(errors.length, 1);
  } finally {
    undo();
  }
});
