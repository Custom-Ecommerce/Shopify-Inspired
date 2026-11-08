import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { signPreviewLink } from '@/lib/preview-token';
import { ArchivedReview, AuditLog, Media, Product, Review, Store, signSession } from '@/lib/services';
import { isLiveProduct, previewLabelOf } from '@/lib/storefront/live-product';

const AUTH_SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
const PREVIEW_SECRET = 'preview-test-secret-preview-test-secret';
const SELLER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const PRODUCT = '65a0000000000000000000b1';
const DRAFT = '65a0000000000000000000b2';
const OTHER = '65a0000000000000000000b3';
const SHARED_MEDIA = '65a0000000000000000000e1';

type Doc = Record<string, unknown>;

interface Row extends Doc {
  _id: string;
  store: string;
  title: string;
  slug: string;
  minPrice: number;
  isPublished: boolean;
  isDemo: boolean;
  hideWhenOutOfStock: boolean;
  deletedAt: Date | null;
  deletedBy: { role?: string; wasPublished?: boolean; reason?: string; user?: unknown } | null;
  moderation: { reason: string; takenDownBy: string; takenDownAt: Date } | null;
  categories: string[];
  media: string[];
  variants: Array<Doc>;
  createdAt: Date;
  updatedAt: Date;
}

interface Chain {
  select: () => Chain;
  sort: () => Chain;
  skip: (count: number) => Chain;
  limit: (count: number) => Chain;
  populate: () => Chain;
  lean: () => Promise<unknown>;
}

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const ProductStub = Product as unknown as {
  find: (filter: Doc) => Chain;
  findOne: (filter: Doc) => Chain;
  findOneAndUpdate: (filter: Doc, update: { $set: Doc }) => Chain;
  countDocuments: (filter: Doc) => Promise<number>;
  deleteOne: (filter: Doc) => Promise<{ deletedCount: number }>;
};
const StoreStub = Store as unknown as {
  find: (filter: Doc) => Chain;
  findById: (id: string) => Chain;
  findOne: (filter: Doc) => Chain;
  exists: (filter: Doc) => Promise<{ _id: string } | null>;
};
const AuditStub = AuditLog as unknown as { create: (doc: Doc) => Promise<{ _id: string }> };
const ReviewStub = Review as unknown as { find: (filter: Doc) => Chain; deleteMany: (filter: Doc) => Promise<unknown> };
const ArchiveStub = ArchivedReview as unknown as { bulkWrite: (ops: unknown[]) => Promise<unknown> };
const MediaStub = Media as unknown as { deleteOne: () => Promise<unknown>; deleteMany: () => Promise<unknown> };

const chain = (result: unknown): Chain => {
  const q: Chain = { select: () => q, sort: () => q, skip: () => q, limit: () => q, populate: () => q, lean: async () => result };
  return q;
};

function matches(row: Row, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some((clause) => matches(row, clause));
    if (key === 'variants') return true;
    if (key === 'deletedBy.role') return row.deletedBy?.role !== (value as { $ne: string }).$ne;
    if (value === null) return (row[key] ?? null) === null;
    if (typeof value === 'object' && '$in' in (value as Doc)) return ((value as { $in: string[] }).$in).includes(String(row[key]));
    if (typeof value === 'object' && '$regex' in (value as Doc)) return new RegExp((value as { $regex: string }).$regex, 'i').test(String(row[key]));
    if (typeof value === 'object' && '$ne' in (value as Doc)) return (row[key] ?? null) !== (value as { $ne: unknown }).$ne;
    return String(row[key]) === String(value);
  });
}

const variant = { _id: '65a0000000000000000000d1', title: 'Default', price: 1000, compareAtPrice: null, trackQuantity: true, stockQuantity: 5, position: 0, optionValues: [] };

function product(id: string, slug: string, overrides: Partial<Row> = {}): Row {
  return {
    _id: id,
    store: STORE,
    title: slug,
    slug,
    minPrice: 1000,
    isPublished: true,
    isDemo: false,
    hideWhenOutOfStock: false,
    deletedAt: null,
    deletedBy: null,
    moderation: null,
    categories: ['65a0000000000000000000c1'],
    media: [SHARED_MEDIA],
    variants: [variant],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

type Ctx<P> = { params: Promise<P> };
type Post = (request: NextRequest) => Promise<Response>;

let takedownPOST: Post;
let restorePOST: Post;
let deletePOST: Post;
let permanentPOST: Post;
let listGET: Post;
let liveGET: (request: NextRequest, context: Ctx<{ id: string }>) => Promise<Response>;
let detailGET: (request: NextRequest, context: Ctx<{ id: string; slug: string }>) => Promise<Response>;
let publishPOST: (request: NextRequest, context: Ctx<{ id: string }>) => Promise<Response>;
let sellerRestorePOST: (request: NextRequest, context: Ctx<{ id: string }>) => Promise<Response>;
let sellerDELETE: (request: NextRequest, context: Ctx<{ id: string }>) => Promise<Response>;
let sellerPATCH: (request: NextRequest, context: Ctx<{ id: string }>) => Promise<Response>;
let token: string;

let products: Row[];
let audits: Doc[];
let archived: unknown[];
let reviews: Doc[];
let mediaDeletes: number;
let auditFails: boolean;
let restore: () => void;

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: SELLER, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  takedownPOST = (await import('../src/app/api/internal/moderation/takedown/route')).POST;
  restorePOST = (await import('../src/app/api/internal/moderation/restore/route')).POST;
  deletePOST = (await import('../src/app/api/internal/moderation/delete/route')).POST;
  permanentPOST = (await import('../src/app/api/internal/moderation/permanent-delete/route')).POST;
  listGET = (await import('../src/app/api/internal/moderation/products/route')).GET;
  liveGET = (await import('../src/app/api/storefront/v1/stores/[id]/products/route')).GET;
  detailGET = (await import('../src/app/api/storefront/v1/stores/[id]/products/[slug]/route')).GET;
  publishPOST = (await import('../src/app/api/products/[id]/publish/route')).POST;
  sellerRestorePOST = (await import('../src/app/api/products/[id]/restore/route')).POST;
  const item = await import('../src/app/api/products/[id]/route');
  sellerDELETE = item.DELETE;
  sellerPATCH = item.PATCH;
});

beforeEach(() => {
  products = [product(PRODUCT, 'live-one'), product(DRAFT, 'draft-one', { isPublished: false }), product(OTHER, 'other-one', { store: OTHER_STORE })];
  audits = [];
  archived = [];
  reviews = [{ _id: 'r1', rating: 5, title: null, body: 'Good', createdAt: new Date(), customerPhone: '+923001234567' }];
  mediaDeletes = 0;
  auditFails = false;

  const saved = {
    connect: mongooseStub.connect,
    p: { ...ProductStub },
    s: { ...StoreStub },
    create: AuditStub.create,
    r: { find: ReviewStub.find, deleteMany: ReviewStub.deleteMany },
    bulk: ArchiveStub.bulkWrite,
    m: { deleteOne: MediaStub.deleteOne, deleteMany: MediaStub.deleteMany },
    env: { mod: process.env.MODERATION_API_SECRET, preview: process.env.PREVIEW_TOKEN_SECRET },
  };
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  process.env.PREVIEW_TOKEN_SECRET = PREVIEW_SECRET;
  mongooseStub.connect = async () => mongoose;

  ProductStub.find = (filter) => chain(products.filter((row) => matches(row, filter)));
  ProductStub.findOne = (filter) => chain(products.find((row) => matches(row, filter)) ?? null);
  ProductStub.countDocuments = async (filter) => products.filter((row) => matches(row, filter)).length;
  ProductStub.findOneAndUpdate = (filter, update) => {
    const row = products.find((candidate) => matches(candidate, filter));
    if (row) Object.assign(row, update.$set);
    return chain(row ?? null);
  };
  ProductStub.deleteOne = async (filter) => {
    const before = products.length;
    products = products.filter((row) => !matches(row, filter));
    return { deletedCount: before - products.length };
  };
  const stores = [
    { _id: STORE, name: 'Alpha', status: 'active', owner: SELLER },
    { _id: OTHER_STORE, name: 'Beta', status: 'active', owner: 'someone-else' },
  ];
  StoreStub.find = (filter) => chain(stores.filter((store) => (filter._id as { $in: string[] }).$in.includes(store._id)));
  StoreStub.findById = (id) => chain(stores.find((store) => store._id === id) ?? null);
  StoreStub.findOne = () => chain(stores[0]);
  StoreStub.exists = async (filter) => (filter._id === STORE ? { _id: STORE } : null);
  AuditStub.create = async (doc) => {
    if (auditFails) throw new Error('audit down');
    audits.push(doc);
    return { _id: 'a' + audits.length };
  };
  ReviewStub.find = () => chain(reviews);
  ReviewStub.deleteMany = async () => {
    reviews = [];
  };
  ArchiveStub.bulkWrite = async (ops) => {
    archived.push(...ops);
  };
  MediaStub.deleteOne = async () => {
    mediaDeletes += 1;
  };
  MediaStub.deleteMany = async () => {
    mediaDeletes += 1;
  };

  restore = () => {
    mongooseStub.connect = saved.connect;
    Object.assign(ProductStub, saved.p);
    Object.assign(StoreStub, saved.s);
    AuditStub.create = saved.create;
    ReviewStub.find = saved.r.find;
    ReviewStub.deleteMany = saved.r.deleteMany;
    ArchiveStub.bulkWrite = saved.bulk;
    MediaStub.deleteOne = saved.m.deleteOne;
    MediaStub.deleteMany = saved.m.deleteMany;
    if (saved.env.mod === undefined) delete process.env.MODERATION_API_SECRET;
    else process.env.MODERATION_API_SECRET = saved.env.mod;
    if (saved.env.preview === undefined) delete process.env.PREVIEW_TOKEN_SECRET;
    else process.env.PREVIEW_TOKEN_SECRET = saved.env.preview;
  };
});

afterEach(() => restore());

function signed(path: string, input?: unknown, now?: number): NextRequest {
  const body = input === undefined ? '' : JSON.stringify(input);
  const method = input === undefined ? 'GET' : 'POST';
  const full = '/api/internal/moderation/' + path;
  return new NextRequest('http://seller.test' + full, {
    method,
    headers: internalRequestHeaders(MOD_SECRET, { method, path: full, adminId: 'admin-1', body }, now),
    ...(input === undefined ? {} : { body }),
  });
}

const row = (id: string): Row => {
  const found = products.find((candidate) => candidate._id === id);
  assert.ok(found);
  return found;
};

const take = (id = PRODUCT, reason = 'Counterfeit goods'): Promise<Response> => takedownPOST(signed('takedown', { productId: id, reason }));
const adminDelete = (id = PRODUCT): Promise<Response> => deletePOST(signed('delete', { productId: id, reason: 'Illegal item' }));

const seller = (method: string, path: string, body?: unknown): NextRequest =>
  new NextRequest('http://seller.test' + path, {
    method,
    headers: { authorization: 'Bearer ' + token, 'x-store-id': STORE, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const idCtx = (id: string): Ctx<{ id: string }> => ({ params: Promise.resolve({ id }) });

async function liveSlugs(query = ''): Promise<string[]> {
  const res = await liveGET(new NextRequest('http://seller.test/api/storefront/v1/stores/' + STORE + '/products' + query), idCtx(STORE));
  const body = (await res.json()) as { data: Array<{ slug: string }> };
  return body.data.map((item) => item.slug);
}

const errorOf = async (res: Response): Promise<Doc> => ((await res.json()) as { errors: Doc[] }).errors[0] ?? {};

test('unsigned, old and tampered requests are a 401, and a seller session means nothing here', async () => {
  const body = JSON.stringify({ productId: PRODUCT, reason: 'Counterfeit goods' });
  const plain = new NextRequest('http://seller.test/api/internal/moderation/takedown', { method: 'POST', body });
  assert.equal((await takedownPOST(plain)).status, 401);

  const session = new NextRequest('http://seller.test/api/internal/moderation/takedown', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body });
  assert.equal((await takedownPOST(session)).status, 401);

  const old = signed('takedown', { productId: PRODUCT, reason: 'Counterfeit goods' }, Date.now() - 6 * 60 * 1000);
  assert.equal((await takedownPOST(old)).status, 401);

  const good = signed('takedown', { productId: PRODUCT, reason: 'Counterfeit goods' });
  const tampered = new NextRequest(good.url, { method: 'POST', headers: good.headers, body: body.replace(PRODUCT, DRAFT) });
  assert.equal((await takedownPOST(tampered)).status, 401);

  assert.equal((await listGET(new NextRequest('http://seller.test/api/internal/moderation/products'))).status, 401);
  assert.equal(row(PRODUCT).moderation, null);
  assert.equal(audits.length, 0);
});

test('reason validation: empty, 2 characters, an HTML tag and over 500 are a 422; nothing is written', async () => {
  for (const reason of ['', '  ', 'ab', '<b>bad</b> item', 'x'.repeat(501)]) {
    const res = await take(PRODUCT, reason);
    assert.equal(res.status, 422, JSON.stringify(reason));
  }
  assert.equal(row(PRODUCT).moderation, null);
  assert.equal(audits.length, 0);
  assert.equal((await take(PRODUCT, '3 < 5 stars')).status, 200);
});

test('takedown takes a product off Live and out of the ids lookup, and the audit names the operator', async () => {
  assert.deepEqual(await liveSlugs(), ['live-one']);
  const res = await take();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; takedownReason: string; storeName: string };
  assert.equal(body.status, 'takedown');
  assert.equal(body.takedownReason, 'Counterfeit goods');
  assert.equal(body.storeName, 'Alpha');
  assert.equal(row(PRODUCT).isPublished, true);

  assert.deepEqual(await liveSlugs(), []);
  assert.deepEqual(await liveSlugs('?ids=' + PRODUCT), []);
  const page = await detailGET(new NextRequest('http://seller.test/x'), { params: Promise.resolve({ id: STORE, slug: 'live-one' }) });
  assert.equal(page.status, 404);

  assert.equal(audits.length, 1);
  const [entry] = audits;
  assert.equal(entry?.action, 'product.takedown');
  assert.equal(entry?.entityId, PRODUCT);
  assert.equal(entry?.actorId, 'admin:admin-1');
  const details = entry?.details as Doc;
  assert.equal(details.storeId, STORE);
  assert.equal(details.reason, 'Counterfeit goods');
  assert.equal(typeof details.at, 'string');
});

test('the Live guard of cart and checkout refuses a taken-down product, and its preview label says so', () => {
  const flags = { isPublished: true, isDemo: false, deletedAt: null };
  assert.equal(isLiveProduct(flags), true);
  assert.equal(isLiveProduct({ ...flags, moderation: { reason: 'x' } }), false);
  assert.equal(previewLabelOf({ ...flags, moderation: { reason: 'x' } }), 'Removed by admin');
});

test('the owner\'s preview still shows it, labelled', async () => {
  await take();
  const { token: link } = await signPreviewLink(STORE);
  const res = await liveGET(new NextRequest('http://seller.test/api/storefront/v1/stores/' + STORE + '/products', { headers: { 'x-markaz-preview': link } }), idCtx(STORE));
  const body = (await res.json()) as { data: Array<{ slug: string; previewLabel: string | null }> };
  assert.equal(body.data.find((item) => item.slug === 'live-one')?.previewLabel, 'Removed by admin');
});

test('takedown twice is idempotent: 200, the first record, one audit entry', async () => {
  await take();
  const at = row(PRODUCT).moderation?.takenDownAt;
  const res = await take(PRODUCT, 'Another reason');
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { takedownReason: string }).takedownReason, 'Counterfeit goods');
  assert.equal(row(PRODUCT).moderation?.takenDownAt, at);
  assert.equal(audits.length, 1);
});

test('a failed audit entry stops the action', async () => {
  auditFails = true;
  const logged = console.error;
  console.error = () => undefined;
  try {
    assert.equal((await take()).status, 500);
  } finally {
    console.error = logged;
  }
  assert.equal(row(PRODUCT).moderation, null);
});

test('the seller cannot publish while taken down, and sees the reason', async () => {
  await take(DRAFT);
  const res = await publishPOST(seller('POST', '/api/products/' + DRAFT + '/publish'), idCtx(DRAFT));
  assert.equal(res.status, 403);
  const error = await errorOf(res);
  assert.equal(error.code, 'PRODUCT_TAKEN_DOWN');
  assert.equal(error.reason, 'Counterfeit goods');
  assert.equal(row(DRAFT).isPublished, false);
});

test('the seller cannot destroy a taken-down product, even from trash', async () => {
  await take();
  Object.assign(row(PRODUCT), { deletedAt: new Date(), deletedBy: { role: 'seller' } });
  const res = await sellerDELETE(new NextRequest('http://seller.test/api/products/' + PRODUCT + '?permanent=true', { method: 'DELETE', headers: { authorization: 'Bearer ' + token, 'x-store-id': STORE } }), idCtx(PRODUCT));
  assert.equal(res.status, 403);
  assert.equal((await errorOf(res)).code, 'PRODUCT_TAKEN_DOWN');
  assert.equal(products.length, 3);
});

test('restore brings a Live product back Live and leaves a draft a draft', async () => {
  await take();
  await take(DRAFT);
  assert.equal((await restorePOST(signed('restore', { productId: PRODUCT }))).status, 200);
  assert.equal((await restorePOST(signed('restore', { productId: DRAFT }))).status, 200);
  assert.deepEqual(await liveSlugs(), ['live-one']);
  assert.equal(row(DRAFT).isPublished, false);
  assert.equal(row(DRAFT).moderation, null);
  assert.deepEqual(audits.map((entry) => entry.action), ['product.takedown', 'product.takedown', 'product.restore', 'product.restore']);
});

test('restore with nothing to undo is a 409, and it leaves a seller\'s own trash alone', async () => {
  const none = await restorePOST(signed('restore', { productId: PRODUCT }));
  assert.equal(none.status, 409);
  assert.equal((await errorOf(none)).code, 'PRODUCT_NOT_MODERATED');

  Object.assign(row(DRAFT), { deletedAt: new Date(), deletedBy: { role: 'seller' } });
  assert.equal((await restorePOST(signed('restore', { productId: DRAFT }))).status, 409);
  assert.ok(row(DRAFT).deletedAt);
  assert.equal(audits.length, 0);
});

test('admin delete blocks the seller\'s restore and permanent delete (D-040), and is idempotent', async () => {
  const res = await adminDelete();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; adminDeleted: boolean; deleteReason: string };
  assert.equal(body.status, 'trash');
  assert.equal(body.adminDeleted, true);
  assert.equal(body.deleteReason, 'Illegal item');
  assert.equal(row(PRODUCT).deletedBy?.role, 'admin');
  assert.deepEqual(await liveSlugs(), []);

  const back = await sellerRestorePOST(seller('POST', '/api/products/' + PRODUCT + '/restore'), idCtx(PRODUCT));
  assert.equal(back.status, 403);
  assert.equal((await errorOf(back)).code, 'PRODUCT_ADMIN_DELETED');
  const gone = await sellerDELETE(new NextRequest('http://seller.test/api/products/' + PRODUCT + '?permanent=true', { method: 'DELETE', headers: { authorization: 'Bearer ' + token, 'x-store-id': STORE } }), idCtx(PRODUCT));
  assert.equal(gone.status, 403);
  assert.equal((await errorOf(gone)).code, 'PRODUCT_ADMIN_DELETED');

  assert.equal((await adminDelete()).status, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, 'product.delete');
});

test('an admin restore undoes an admin delete: back to Live, and the seller lock is gone', async () => {
  await take();
  await adminDelete();
  assert.equal((await restorePOST(signed('restore', { productId: PRODUCT }))).status, 200);
  const restored = row(PRODUCT);
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.deletedBy, null);
  assert.equal(restored.moderation, null);
  assert.equal(restored.isPublished, true);
  assert.deepEqual(await liveSlugs(), ['live-one']);
});

test('a draft an admin deleted comes back a draft', async () => {
  await adminDelete(DRAFT);
  await restorePOST(signed('restore', { productId: DRAFT }));
  assert.equal(row(DRAFT).isPublished, false);
  assert.equal(row(DRAFT).deletedAt, null);
});

test('an admin delete of a seller\'s trash is refused, and permanent delete is the way', async () => {
  Object.assign(row(DRAFT), { deletedAt: new Date(), deletedBy: { role: 'seller' } });
  const res = await adminDelete(DRAFT);
  assert.equal(res.status, 409);
  assert.equal((await errorOf(res)).code, 'PRODUCT_IN_SELLER_TRASH');
});

test('permanent delete needs trash, archives reviews without the customer, keeps Media, and is audited', async () => {
  const early = await permanentPOST(signed('permanent-delete', { productId: PRODUCT, reason: 'Illegal item' }));
  assert.equal(early.status, 409);
  assert.equal((await errorOf(early)).code, 'PRODUCT_NOT_IN_TRASH');

  await adminDelete();
  const res = await permanentPOST(signed('permanent-delete', { productId: PRODUCT, reason: 'Illegal item' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true, productId: PRODUCT });
  assert.equal(products.some((candidate) => candidate._id === PRODUCT), false);
  assert.equal(archived.length, 1);
  assert.equal(JSON.stringify(archived).includes('+923001234567'), false);
  assert.equal(reviews.length, 0);
  assert.equal(mediaDeletes, 0);
  assert.deepEqual(audits.map((entry) => entry.action), ['product.delete', 'product.permanent-delete']);
});

test('an unknown product is a 404 and writes no audit entry', async () => {
  const res = await take('65a0000000000000000000ff');
  assert.equal(res.status, 404);
  assert.equal(audits.length, 0);
});

test('the list crosses stores, filters by store, status and title, caps the limit, and names no seller', async () => {
  await take();
  const res = await listGET(signed('products'));
  assert.equal(res.status, 200);
  const all = (await res.json()) as { docs: Array<Doc>; totalDocs: number };
  assert.equal(all.totalDocs, 3);
  assert.equal(JSON.stringify(all).includes(SELLER), false);
  assert.deepEqual(Object.keys(all.docs[0] ?? {}).sort(), [
    'adminDeleted', 'createdAt', 'deleteReason', 'deletedAt', 'productId', 'slug', 'status', 'storeId', 'storeName', 'takedownReason', 'takenDownAt', 'title', 'updatedAt',
  ]);

  const count = async (query: string): Promise<number> => ((await (await listGET(signed('products' + query))).json()) as { totalDocs: number }).totalDocs;
  assert.equal(await count('?storeId=' + OTHER_STORE), 1);
  assert.equal(await count('?status=takedown'), 1);
  assert.equal(await count('?status=live'), 1);
  assert.equal(await count('?status=draft'), 1);
  assert.equal(await count('?status=trash'), 0);
  assert.equal(await count('?q=draft'), 1);
  assert.equal((await listGET(signed('products?limit=51'))).status, 422);
  assert.equal((await listGET(signed('products?limit=50'))).status, 200);
});

test('a seller edit of a taken-down product is allowed and does not lift the takedown', async () => {
  await take();
  const res = await sellerPATCH(seller('PATCH', '/api/products/' + PRODUCT, { description: 'Fixed' }), idCtx(PRODUCT));
  assert.equal(res.status, 200);
  assert.ok(row(PRODUCT).moderation);
  assert.equal(((await res.json()) as { takedown: { reason: string } }).takedown.reason, 'Counterfeit goods');
});
