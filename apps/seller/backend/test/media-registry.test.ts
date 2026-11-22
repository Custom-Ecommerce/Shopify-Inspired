import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Media, Product, signSession, Store } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { MEDIA_USAGE_ITEM_CAP, findMediaUsage, listMediaFeatures, registerMediaFeature, unregisterMediaFeature, type MediaFeature } from '../src/lib/media-usage';
import { mediaUsage, removeMediaIfUnused } from '../src/lib/media-cleanup';
import { SWEEP_SCAN_LIMIT, sweepOrphanMedia, type SweepFilePort } from '../src/lib/media-sweep';

// Sprint 7 (S7-B1, CO-10): the media registry, rename, usage, delete (409) and the orphan sweep. Models and Cloudinary are stubbed; no database, no network.

const SECRET = 'x'.repeat(40);
const CRON = 'c'.repeat(32);
const oid = (n: number): string => n.toString(16).padStart(24, '0');
const USER_A = oid(1);
const USER_B = oid(2);
const ADMIN = oid(3);
const STORE_A = oid(11);
const STORE_B = oid(12);
const MEDIA_A = oid(101); // store A, used by a product
const MEDIA_A_FREE = oid(102); // store A, used by nothing
const MEDIA_A_LOGO = oid(103); // store A, used as the logo
const MEDIA_B = oid(201); // store B
const PRODUCT_A = oid(301);
const URL_A = 'https://res.cloudinary.com/demo/image/upload/v1/markaz/a.jpg';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-20T10:00:00Z');
const OLD = new Date(NOW.getTime() - 90 * DAY);
const RECENT = new Date(NOW.getTime() - 2 * DAY);

const MediaModel = Media as any;
const ProductModel = Product as any;
const StoreModel = Store as any;
const AuditModel = AuditLog as any;

let media: Array<Record<string, any>> = [];
let products: Array<Record<string, any>> = [];
let stores: Record<string, Record<string, any>> = {};
let audits: Array<Record<string, any>> = [];
let destroyed: string[] = [];
let productCounts = 0;
let updates: Array<{ filter: any; update: any }> = [];
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};

type Ctx = { params: Promise<{ id: string }> };
let patch: (r: NextRequest, c: Ctx) => Promise<Response>;
let del: (r: NextRequest, c: Ctx) => Promise<Response>;
let usageGET: (r: NextRequest, c: Ctx) => Promise<Response>;
let sweepPOST: (r: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  const route = await import('../src/app/api/media/[id]/route');
  patch = route.PATCH;
  del = route.DELETE;
  usageGET = (await import('../src/app/api/media/[id]/usage/route')).GET;
  sweepPOST = (await import('../src/app/api/internal/media/orphans/route')).POST;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, limit: () => q, lean: async () => value() };
  return q;
};

/** The Mongo operators the code under test uses on Media. */
function mediaMatches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$lt' in cond) return new Date(row[key]).getTime() < new Date(cond.$lt).getTime();
      if ('$gt' in cond) return String(row[key]) > String(cond.$gt);
    }
    return String(row[key]) === String(cond);
  });
}

function productMatches(row: Record<string, any>, filter: Record<string, any>): boolean {
  if (String(row.store) !== String(filter.store)) return false;
  return (filter.$or as Array<Record<string, any>>).some((clause) => {
    const [key, value] = Object.entries(clause)[0]!;
    if (key === 'media') return (row.media ?? []).map(String).includes(String(value));
    if (key === 'videos') return (row.videos ?? []).map(String).includes(String(value));
    if (key === 'variants.imageId') return (row.variants ?? []).some((v: any) => String(v.imageId) === String(value));
    if (key === 'seoImage') return String(row.seoImage) === String(value);
    return false;
  });
}

beforeEach(() => {
  media = [
    { _id: MEDIA_A, store: STORE_A, alt: 'Shirt front', name: null, url: URL_A, cloudinaryPublicId: 'markaz/a', cloudinaryResourceType: 'image', resourceType: 'image', createdAt: OLD, updatedAt: OLD },
    { _id: MEDIA_A_FREE, store: STORE_A, alt: 'Unused', name: 'Spare', url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/free.jpg', cloudinaryPublicId: 'markaz/free', cloudinaryResourceType: 'image', resourceType: 'image', createdAt: OLD, updatedAt: OLD },
    { _id: MEDIA_A_LOGO, store: STORE_A, alt: 'Logo', name: null, url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/logo.jpg', cloudinaryPublicId: 'markaz/logo', cloudinaryResourceType: 'image', resourceType: 'image', createdAt: OLD, updatedAt: OLD },
    { _id: MEDIA_B, store: STORE_B, alt: 'Other store', name: null, url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/b.jpg', cloudinaryPublicId: 'markaz/b', cloudinaryResourceType: 'image', resourceType: 'image', createdAt: OLD, updatedAt: OLD },
  ];
  products = [{ _id: PRODUCT_A, store: STORE_A, title: 'Lawn suit', media: [MEDIA_A], videos: [], variants: [], seoImage: null }];
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, slug: 'zara', storefront: { logo: MEDIA_A_LOGO } },
    [STORE_B]: { _id: STORE_B, owner: USER_B, slug: 'bilal', storefront: {} },
  };
  audits = [];
  destroyed = [];
  updates = [];
  productCounts = 0;
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = 'k';
  process.env.CLOUDINARY_API_SECRET = 's';
  process.env.OUTBOX_CRON_SECRET = CRON;

  const saved = {
    connect: (mongoose as any).connect,
    fetch: globalThis.fetch,
    media: Object.fromEntries(['findOne', 'find', 'updateOne', 'findOneAndDelete'].map((m) => [m, MediaModel[m]])),
    product: Object.fromEntries(['countDocuments', 'find'].map((m) => [m, ProductModel[m]])),
    store: Object.fromEntries(['findOne', 'exists'].map((m) => [m, StoreModel[m]])),
    audit: AuditModel.create,
  };
  (mongoose as any).connect = async () => mongoose;
  // The Cloudinary destroy call: recorded, always answered ok.
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const form = init?.body as FormData;
    destroyed.push(String(form.get('public_id')));
    return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
  }) as typeof fetch;

  MediaModel.findOne = (filter: any) => chain(() => structuredClone(media.find((row) => mediaMatches(row, filter)) ?? null));
  MediaModel.find = (filter: any) => {
    const rows = media.filter((row) => mediaMatches(row, filter)).sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1));
    let cap = Infinity;
    const q: any = { select: () => q, sort: () => q, limit: (n: number) => ((cap = n), q), lean: async () => structuredClone(rows.slice(0, cap)) };
    return q;
  };
  MediaModel.updateOne = async (filter: any, update: any) => {
    updates.push({ filter, update });
    const row = media.find((r) => mediaMatches(r, filter));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, update.$set ?? {});
    row.updatedAt = new Date(NOW.getTime());
    return { matchedCount: 1 };
  };
  MediaModel.findOneAndDelete = (filter: any) =>
    chain(() => {
      const index = media.findIndex((row) => mediaMatches(row, filter));
      return index === -1 ? null : media.splice(index, 1)[0];
    });
  ProductModel.countDocuments = async (filter: any) => {
    productCounts += 1;
    return products.filter((row) => productMatches(row, filter)).length;
  };
  ProductModel.find = (filter: any) => chain(() => structuredClone(products.filter((row) => productMatches(row, filter))));
  StoreModel.findOne = (filter: any) => chain(() => (stores[String(filter._id)] ? structuredClone(stores[String(filter._id)]) : null));
  StoreModel.exists = async (filter: any) => (stores[String(filter._id)] && String(stores[String(filter._id)]!.owner) === String(filter.owner) ? { _id: filter._id } : null);
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    globalThis.fetch = saved.fetch;
    for (const [m, fn] of Object.entries(saved.media)) MediaModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.product)) ProductModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    AuditModel.create = saved.audit;
    delete process.env.OUTBOX_CRON_SECRET;
    unregisterMediaFeature('fake-articles');
  };
});

afterEach(() => restore());

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (method: string, id: string, token: string | null, storeId: string | null, body?: unknown, raw?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = 'Bearer ' + token;
  if (storeId !== null) headers['x-store-id'] = storeId;
  return new NextRequest('http://seller.test/api/media/' + id, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
};
const rename = (id: string, body: unknown, token: string | null = tokenA, storeId: string | null = STORE_A) => patch(call('PATCH', id, token, storeId, body), params(id));
const usage = (id: string, token: string | null = tokenA, storeId: string | null = STORE_A) => usageGET(call('GET', id, token, storeId), params(id));
const remove = (id: string, token: string | null = tokenA, storeId: string | null = STORE_A) => del(call('DELETE', id, token, storeId), params(id));
type Body = { code?: string; field?: string; errors?: Array<{ message: string }>; [key: string]: any };

/** A feature that registered itself the way articles, pages and theme config will: it uses the given media ids. */
function fakeFeature(usedIds: () => string[]): MediaFeature {
  return {
    key: 'fake-articles',
    label: 'Articles',
    async find(storeId, mediaId) {
      const used = String(storeId) === STORE_A && usedIds().includes(mediaId);
      return { count: used ? 1 : 0, items: used ? [{ id: oid(900), title: 'Eid sale post' }] : [] };
    },
  };
}

// ------------------------------------------------------------------------------------------------------ the registry

test('the registry has the built-in features: products and store settings', () => {
  const keys = listMediaFeatures().map((f) => f.key);
  assert.ok(keys.includes('products'));
  assert.ok(keys.includes('branding'));
});

test('findMediaUsage asks every registered feature, in one answer with counts and titles', async () => {
  const used = await findMediaUsage(STORE_A, MEDIA_A);
  assert.equal(used.inUse, true);
  assert.equal(used.total, 1);
  assert.deepEqual(used.features, [{ key: 'products', label: 'Products', count: 1, items: [{ id: PRODUCT_A, title: 'Lawn suit' }] }]);
  const logo = await findMediaUsage(STORE_A, MEDIA_A_LOGO);
  assert.deepEqual(logo.features, [{ key: 'branding', label: 'Store settings', count: 1, items: [{ id: 'logo', title: 'Store logo' }] }]);
  const free = await findMediaUsage(STORE_A, MEDIA_A_FREE);
  assert.deepEqual(free, { mediaId: MEDIA_A_FREE, inUse: false, total: 0, features: [] });
});

test('a fake registered feature is counted next to the built-in ones, and leaves with unregister', async () => {
  let usedIds = [MEDIA_A_FREE];
  registerMediaFeature(fakeFeature(() => usedIds));
  const used = await findMediaUsage(STORE_A, MEDIA_A_FREE);
  assert.equal(used.inUse, true);
  assert.deepEqual(used.features.map((f) => f.key), ['fake-articles']);
  assert.equal(used.features[0]!.label, 'Articles');
  usedIds = [MEDIA_A];
  const both = await findMediaUsage(STORE_A, MEDIA_A);
  assert.deepEqual(both.features.map((f) => f.key).sort(), ['fake-articles', 'products']);
  assert.equal(both.total, 2);
  unregisterMediaFeature('fake-articles');
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A_FREE)).inUse, false);
});

test('registering a key again replaces the earlier entry instead of counting the file twice', async () => {
  registerMediaFeature(fakeFeature(() => [MEDIA_A_FREE]));
  registerMediaFeature(fakeFeature(() => [MEDIA_A_FREE]));
  assert.equal(listMediaFeatures().filter((f) => f.key === 'fake-articles').length, 1);
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A_FREE)).total, 1);
});

test('a feature that fails makes the whole answer fail: unknown is never read as unused', async () => {
  registerMediaFeature({
    key: 'fake-articles',
    label: 'Articles',
    async find() {
      throw new Error('articles database down');
    },
  });
  await assert.rejects(() => findMediaUsage(STORE_A, MEDIA_A_FREE), /articles database down/);
  // The cleanup helper swallows the error, and so deletes nothing.
  await removeMediaIfUnused(STORE_A, MEDIA_A_FREE);
  assert.ok(media.some((row) => String(row._id) === MEDIA_A_FREE), 'the record is still there');
  assert.deepEqual(destroyed, []);
});

test('the item list of a feature is capped, the count is the real one', async () => {
  registerMediaFeature({
    key: 'fake-articles',
    label: 'Articles',
    async find() {
      return { count: 57, items: Array.from({ length: 57 }, (_, i) => ({ id: oid(1000 + i), title: 'Post ' + i })) };
    },
  });
  const fake = (await findMediaUsage(STORE_A, MEDIA_A_FREE)).features.find((f) => f.key === 'fake-articles')!;
  assert.equal(fake.count, 57);
  assert.equal(fake.items.length, MEDIA_USAGE_ITEM_CAP);
});

test('mediaUsage keeps its Sprint 4 shape (a product count and the branding keys) and adds the registry answer', async () => {
  const forProduct = await mediaUsage(STORE_A, MEDIA_A);
  assert.equal(forProduct.products, 1);
  assert.deepEqual(forProduct.branding, []);
  assert.equal(forProduct.inUse, true);
  const forLogo = await mediaUsage(STORE_A, MEDIA_A_LOGO);
  assert.equal(forLogo.products, 0);
  assert.deepEqual(forLogo.branding, ['logo']);
  assert.equal((await mediaUsage(STORE_A, MEDIA_A_FREE)).inUse, false);
});

test('mediaUsage finds a product through its videos, a variant image and its SEO image too', async () => {
  products.push({ _id: oid(302), store: STORE_A, title: 'Video product', media: [], videos: [MEDIA_A_FREE], variants: [], seoImage: null });
  assert.equal((await mediaUsage(STORE_A, MEDIA_A_FREE)).products, 1);
  products = [{ _id: oid(303), store: STORE_A, title: 'Variants', media: [], videos: [], variants: [{ imageId: MEDIA_A_FREE }], seoImage: null }];
  assert.equal((await mediaUsage(STORE_A, MEDIA_A_FREE)).products, 1);
  products = [{ _id: oid(304), store: STORE_A, title: 'SEO', media: [], videos: [], variants: [], seoImage: MEDIA_A_FREE }];
  assert.equal((await mediaUsage(STORE_A, MEDIA_A_FREE)).products, 1);
});

test('removeMediaIfUnused removes an unused file and its Cloudinary asset, and never a used one (any feature)', async () => {
  await removeMediaIfUnused(STORE_A, MEDIA_A);
  await removeMediaIfUnused(STORE_A, MEDIA_A_LOGO);
  assert.equal(media.length, 4, 'a product image and the logo stay');
  registerMediaFeature(fakeFeature(() => [MEDIA_A_FREE]));
  await removeMediaIfUnused(STORE_A, MEDIA_A_FREE);
  assert.equal(media.length, 4, 'a file used only by a registered feature stays too');
  assert.deepEqual(destroyed, []);
  unregisterMediaFeature('fake-articles');
  await removeMediaIfUnused(STORE_A, MEDIA_A_FREE);
  assert.equal(media.length, 3);
  assert.deepEqual(destroyed, ['markaz/free']);
  await removeMediaIfUnused(STORE_A, null);
  await removeMediaIfUnused(STORE_A, 'not-an-id');
  assert.equal(media.length, 3);
});

// ---------------------------------------------------------------------------------------------------------------- rename

test('PATCH /api/media/:id renames the file: the name changes, the url, the alt text and the Cloudinary id never do', async () => {
  const before = structuredClone(media.find((row) => row._id === MEDIA_A)!);
  const res = await rename(MEDIA_A, { name: '  Summer lookbook  ' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.id, MEDIA_A);
  assert.equal(body.name, 'Summer lookbook');
  assert.equal(body.url, URL_A, 'the answer carries the same url');
  const after = media.find((row) => row._id === MEDIA_A)!;
  assert.equal(after.url, before.url);
  assert.equal(after.alt, before.alt);
  assert.equal(after.cloudinaryPublicId, before.cloudinaryPublicId);
  assert.equal(after.store, before.store);
  assert.equal(after.name, 'Summer lookbook');
  // ONE write, a $set of the name and nothing else, filtered by id and store.
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]!.update, { $set: { name: 'Summer lookbook' } });
  assert.deepEqual(updates[0]!.filter, { _id: MEDIA_A, store: STORE_A });
  assert.deepEqual(destroyed, [], 'a rename never touches Cloudinary');
});

test('a rename is audited (media.rename), with the old and the new name', async () => {
  await rename(MEDIA_A_FREE, { name: 'Spare 2' });
  assert.equal(audits.length, 1);
  const entry = audits[0]!;
  assert.equal(entry.action, 'media.rename');
  const text = JSON.stringify(entry);
  assert.ok(text.includes('Spare 2') && text.includes('Spare'));
});

test('a rename of a file used by a product still works (a rename is not a removal)', async () => {
  assert.equal((await rename(MEDIA_A, { name: 'Renamed' })).status, 200);
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A)).inUse, true);
});

test('rename: a bad body is a 400 MEDIA_RENAME_INVALID that names the field, and nothing is written', async () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'name'],
    [{ name: '' }, 'name'],
    [{ name: '   ' }, 'name'],
    [{ name: 'x'.repeat(121) }, 'name'],
    [{ name: 7 }, 'name'],
    [{ name: 'Fine', url: 'https://evil.example/x.jpg' }, 'url'],
    [{ name: 'Fine', store: STORE_B }, 'store'],
    [{ name: 'Fine', alt: 'changed' }, 'alt'],
    [{ name: 'Fine', cloudinaryPublicId: 'x' }, 'cloudinaryPublicId'],
  ];
  for (const [body, field] of cases) {
    const res = await rename(MEDIA_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'MEDIA_RENAME_INVALID', JSON.stringify(body));
    assert.equal(out.field, field, JSON.stringify(body));
  }
  const notJson = await patch(call('PATCH', MEDIA_A, tokenA, STORE_A, undefined, 'not json'), params(MEDIA_A));
  assert.equal(notJson.status, 400);
  assert.equal(((await notJson.json()) as Body).field, 'name');
  assert.equal(updates.length, 0);
  assert.equal(media.find((row) => row._id === MEDIA_A)!.name, null);
});

test('rename: no session is 401, an admin is 403, and neither writes', async () => {
  assert.equal((await rename(MEDIA_A, { name: 'x' }, null)).status, 401);
  assert.equal((await rename(MEDIA_A, { name: 'x' }, tokenAdmin)).status, 403);
  assert.equal(updates.length, 0);
});

test('rename: a bad id and an unknown id are 404', async () => {
  assert.equal((await rename('not-an-id', { name: 'x' })).status, 404);
  assert.equal((await rename(oid(999), { name: 'x' })).status, 404);
  assert.equal(updates.length, 0);
});

test('Seller B cannot rename Seller A media: another store id is 403, A\'s record under B\'s own store is 404, and the file is unchanged', async () => {
  assert.equal((await rename(MEDIA_A, { name: 'Hijacked' }, tokenB, STORE_A)).status, 403);
  assert.equal((await rename(MEDIA_A, { name: 'Hijacked' }, tokenB, STORE_B)).status, 404);
  assert.equal(updates.length, 0, 'no write was attempted');
  assert.equal(media.find((row) => row._id === MEDIA_A)!.name, null);
  assert.equal(audits.length, 0);
  // And B's own file can be renamed by B only.
  assert.equal((await rename(MEDIA_B, { name: 'Mine' }, tokenB, STORE_B)).status, 200);
  assert.equal((await rename(MEDIA_B, { name: 'Not yours' }, tokenA, STORE_A)).status, 404);
  assert.equal(media.find((row) => row._id === MEDIA_B)!.name, 'Mine');
});

// ------------------------------------------------------------------------------------------------------------- usage

test('GET /api/media/:id/usage lists where a file is used, with the titles', async () => {
  const res = await usage(MEDIA_A);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    mediaId: MEDIA_A,
    inUse: true,
    total: 1,
    features: [{ key: 'products', label: 'Products', count: 1, items: [{ id: PRODUCT_A, title: 'Lawn suit' }] }],
  });
  const logo = (await (await usage(MEDIA_A_LOGO)).json()) as Body;
  assert.equal(logo.features[0].key, 'branding');
  const free = (await (await usage(MEDIA_A_FREE)).json()) as Body;
  assert.deepEqual(free, { mediaId: MEDIA_A_FREE, inUse: false, total: 0, features: [] });
});

test('GET usage includes a feature registered later (articles, pages, theme config)', async () => {
  registerMediaFeature(fakeFeature(() => [MEDIA_A_FREE]));
  const body = (await (await usage(MEDIA_A_FREE)).json()) as Body;
  assert.equal(body.inUse, true);
  assert.deepEqual(body.features, [{ key: 'fake-articles', label: 'Articles', count: 1, items: [{ id: oid(900), title: 'Eid sale post' }] }]);
});

test('usage: no session 401, admin 403, bad or unknown id 404', async () => {
  assert.equal((await usage(MEDIA_A, null)).status, 401);
  assert.equal((await usage(MEDIA_A, tokenAdmin)).status, 403);
  assert.equal((await usage('not-an-id')).status, 404);
  assert.equal((await usage(oid(999))).status, 404);
});

test('Seller B cannot read the usage of Seller A media: 403 for A\'s store, 404 for the record under B\'s own, and nothing about A is looked up', async () => {
  assert.equal((await usage(MEDIA_A, tokenB, STORE_A)).status, 403);
  const foreign = await usage(MEDIA_A, tokenB, STORE_B);
  assert.equal(foreign.status, 404);
  assert.equal(JSON.stringify(await foreign.json()).includes('Lawn suit'), false, 'a product title of another store never leaks');
  assert.equal(productCounts, 0, 'the usage was never computed for the foreign file');
});

// ------------------------------------------------------------------------------------------------------------- delete

test('DELETE of a file a product uses answers 409 MEDIA_IN_USE with the same list as the usage route, and deletes nothing', async () => {
  const listed = (await (await usage(MEDIA_A)).json()) as Body;
  const res = await remove(MEDIA_A);
  assert.equal(res.status, 409);
  const body = (await res.json()) as Body;
  assert.equal(body.code, 'MEDIA_IN_USE');
  assert.deepEqual({ mediaId: body.mediaId, inUse: body.inUse, total: body.total, features: body.features }, listed);
  assert.equal(body.products, 1, 'the Sprint 4 fields stay');
  assert.deepEqual(body.branding, []);
  assert.ok(media.some((row) => row._id === MEDIA_A), 'the record is still there');
  assert.deepEqual(destroyed, [], 'the Cloudinary file is still there');
  assert.equal(audits.length, 0);
});

test('DELETE of the store logo is a 409 naming the store settings', async () => {
  const res = await remove(MEDIA_A_LOGO);
  assert.equal(res.status, 409);
  const body = (await res.json()) as Body;
  assert.deepEqual(body.branding, ['logo']);
  assert.equal(body.features[0].label, 'Store settings');
  assert.ok(media.some((row) => row._id === MEDIA_A_LOGO));
});

test('a used file is never deleted: a file used only by a registered feature is a 409 too, and a file nothing uses is deleted with its Cloudinary asset', async () => {
  registerMediaFeature(fakeFeature(() => [MEDIA_A_FREE]));
  const refused = await remove(MEDIA_A_FREE);
  assert.equal(refused.status, 409);
  const body = (await refused.json()) as Body;
  assert.equal(body.features[0].key, 'fake-articles');
  assert.equal(body.features[0].items[0].title, 'Eid sale post');
  assert.ok(media.some((row) => row._id === MEDIA_A_FREE));
  assert.deepEqual(destroyed, []);

  unregisterMediaFeature('fake-articles');
  const done = await remove(MEDIA_A_FREE);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { deleted: true });
  assert.ok(!media.some((row) => row._id === MEDIA_A_FREE));
  assert.deepEqual(destroyed, ['markaz/free']);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'media.delete');
});

test('Seller B cannot delete Seller A media: 403 for A\'s store, 404 for the record under B\'s own, and the file stays (even an unused one)', async () => {
  assert.equal((await remove(MEDIA_A_FREE, tokenB, STORE_A)).status, 403);
  assert.equal((await remove(MEDIA_A_FREE, tokenB, STORE_B)).status, 404);
  assert.equal((await remove(MEDIA_A, tokenB, STORE_B)).status, 404);
  assert.equal(media.length, 4);
  assert.deepEqual(destroyed, []);
  assert.equal(audits.length, 0);
});

test('delete: no session 401, admin 403, bad id 404', async () => {
  assert.equal((await remove(MEDIA_A_FREE, null)).status, 401);
  assert.equal((await remove(MEDIA_A_FREE, tokenAdmin)).status, 403);
  assert.equal((await remove('not-an-id')).status, 404);
  assert.equal(media.length, 4);
});

// ------------------------------------------------------------------------------------------------------------ the sweep

const fakePort = (failFor: string[] = []): SweepFilePort & { deleted: string[] } => {
  const deleted: string[] = [];
  return {
    deleted,
    async deleteFile(publicId) {
      deleted.push(publicId);
      return !failFor.includes(publicId);
    },
  };
};

test('sweep, dry run: lists the unused records older than N days, deletes nothing, and calls Cloudinary never', async () => {
  media.push({ _id: oid(104), store: STORE_A, alt: 'Fresh upload', name: null, url: 'https://x/y.jpg', cloudinaryPublicId: 'markaz/fresh', resourceType: 'image', createdAt: RECENT, updatedAt: RECENT });
  const port = fakePort();
  const result = await sweepOrphanMedia({ apply: false, olderThanDays: 30, now: NOW, files: port });
  assert.equal(result.dryRun, true);
  assert.equal(result.deleted, 0);
  assert.equal(result.scanned, 4, 'the fresh one is too young to be looked at');
  assert.deepEqual(result.orphans.map((o) => o.id).sort(), [MEDIA_A_FREE, MEDIA_B].sort());
  assert.equal(result.orphanCount, 2);
  assert.equal(result.orphans.find((o) => o.id === MEDIA_A_FREE)!.name, 'Spare');
  assert.equal(media.length, 5);
  assert.deepEqual(port.deleted, []);
  assert.equal(audits.length, 0, 'a dry run writes no audit line');
});

test('sweep, apply: removes the orphans and their files, keeps every used or young one', async () => {
  media.push({ _id: oid(104), store: STORE_A, alt: 'Fresh upload', name: null, url: 'https://x/y.jpg', cloudinaryPublicId: 'markaz/fresh', resourceType: 'image', createdAt: RECENT, updatedAt: RECENT });
  const port = fakePort();
  const result = await sweepOrphanMedia({ apply: true, olderThanDays: 30, now: NOW, files: port });
  assert.equal(result.dryRun, false);
  assert.equal(result.deleted, 2);
  assert.deepEqual(port.deleted.sort(), ['markaz/b', 'markaz/free']);
  assert.deepEqual(media.map((row) => row._id).sort(), [MEDIA_A, MEDIA_A_LOGO, oid(104)].sort(), 'the product image, the logo and the fresh upload stay');
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'media.orphan-sweep');
});

test('sweep: a file used only by a registered feature is kept, and so is one that becomes used between the listing and the delete', async () => {
  registerMediaFeature(fakeFeature(() => [MEDIA_A_FREE]));
  const port = fakePort();
  const first = await sweepOrphanMedia({ apply: true, olderThanDays: 30, now: NOW, files: port });
  assert.equal(first.deleted, 1, 'only store B media (unused) goes');
  assert.ok(media.some((row) => row._id === MEDIA_A_FREE));

  // Becomes used after the listing: the feature answers "unused" the first time and "used" the second time.
  unregisterMediaFeature('fake-articles');
  let asked = 0;
  registerMediaFeature({
    key: 'fake-articles',
    label: 'Articles',
    async find(_store, mediaId) {
      if (mediaId !== MEDIA_A_FREE) return { count: 0, items: [] };
      asked += 1;
      return asked === 1 ? { count: 0, items: [] } : { count: 1, items: [{ id: oid(900), title: 'Late post' }] };
    },
  });
  const second = await sweepOrphanMedia({ apply: true, olderThanDays: 30, now: NOW, files: port });
  assert.equal(second.keptInUse, 1);
  assert.equal(second.deleted, 0);
  assert.ok(media.some((row) => row._id === MEDIA_A_FREE));
});

test('sweep: a Cloudinary failure is counted, the record is gone either way, and the run goes on', async () => {
  const port = fakePort(['markaz/free']);
  const result = await sweepOrphanMedia({ apply: true, olderThanDays: 30, now: NOW, files: port });
  assert.equal(result.deleted, 2);
  assert.equal(result.fileFailures, 1);
  assert.deepEqual(port.deleted.sort(), ['markaz/b', 'markaz/free']);
});

test('sweep: a video is deleted as a video, and one scan is bounded, with a way to continue', async () => {
  media = [{ _id: oid(500), store: STORE_A, alt: 'Clip', url: 'https://x/clip.mp4', cloudinaryPublicId: 'markaz/clip', resourceType: 'video', createdAt: OLD, updatedAt: OLD }];
  const kinds: string[] = [];
  const port: SweepFilePort = { async deleteFile(_id, resource) { kinds.push(resource); return true; } };
  await sweepOrphanMedia({ apply: true, olderThanDays: 30, now: NOW, files: port });
  assert.deepEqual(kinds, ['video']);

  media = Array.from({ length: SWEEP_SCAN_LIMIT + 5 }, (_, i) => ({ _id: oid(1000 + i), store: STORE_B, alt: 'f' + i, url: 'https://x/' + i, cloudinaryPublicId: 'markaz/f' + i, resourceType: 'image', createdAt: OLD, updatedAt: OLD }));
  const page1 = await sweepOrphanMedia({ apply: false, olderThanDays: 30, now: NOW, files: fakePort() });
  assert.equal(page1.scanned, SWEEP_SCAN_LIMIT);
  assert.equal(page1.more, true);
  assert.equal(page1.nextAfter, oid(1000 + SWEEP_SCAN_LIMIT - 1));
  assert.ok(page1.orphans.length <= 50, 'the listing is a sample');
  assert.equal(page1.orphanCount, SWEEP_SCAN_LIMIT);
  const page2 = await sweepOrphanMedia({ apply: false, olderThanDays: 30, now: NOW, after: page1.nextAfter, files: fakePort() });
  assert.equal(page2.scanned, 5);
  assert.equal(page2.more, false);
  assert.equal(page2.nextAfter, null);
});

// ------------------------------------------------------------------------------------------------------ the sweep route

const sweep = (body: unknown, headers: Record<string, string> = { 'x-cron-secret': CRON }) =>
  sweepPOST(
    new NextRequest('http://seller.test/api/internal/media/orphans', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

test('sweep route: without the cron secret, with a wrong one, or while it is not set on the server, it is 401 and does nothing', async () => {
  assert.equal((await sweep(undefined, {})).status, 401);
  assert.equal((await sweep(undefined, { 'x-cron-secret': 'wrong-secret-wrong-secret-wrong!' })).status, 401);
  assert.equal((await sweep({ apply: true }, { authorization: 'Bearer nope' })).status, 401);
  delete process.env.OUTBOX_CRON_SECRET;
  assert.equal((await sweep(undefined)).status, 401);
  assert.equal(media.length, 4);
  assert.deepEqual(destroyed, []);
});

test('sweep route: an empty body is a dry run (default 30 days), and the bearer form of the secret works too', async () => {
  const res = await sweep(undefined, { authorization: 'Bearer ' + CRON });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.dryRun, true);
  assert.equal(body.olderThanDays, 30);
  assert.equal(body.orphanCount, 2);
  assert.equal(media.length, 4);
  assert.deepEqual(destroyed, []);
  const explicit = (await (await sweep({ apply: false })).json()) as Body;
  assert.equal(explicit.dryRun, true);
});

test('sweep route: apply deletes through Cloudinary (stubbed fetch) and the answer says how many', async () => {
  const res = await sweep({ apply: true, olderThanDays: 7 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.dryRun, false);
  assert.equal(body.olderThanDays, 7);
  assert.equal(body.deleted, 2);
  assert.deepEqual(destroyed.sort(), ['markaz/b', 'markaz/free']);
  assert.deepEqual(media.map((row) => row._id).sort(), [MEDIA_A, MEDIA_A_LOGO].sort());
});

test('sweep route: a younger cutoff skips recent files; a bad body is a 400 naming the field and does nothing', async () => {
  media.push({ _id: oid(104), store: STORE_A, alt: 'Fresh', url: 'https://x/y.jpg', cloudinaryPublicId: 'markaz/fresh', resourceType: 'image', createdAt: RECENT, updatedAt: RECENT });
  const young = (await (await sweep({ olderThanDays: 1 })).json()) as Body;
  assert.equal(young.orphanCount, 3, 'with a one day cutoff the 2 day old file counts');
  const cases: Array<[unknown, string | undefined]> = [
    [{ apply: 'yes' }, 'apply'],
    [{ olderThanDays: 0 }, 'olderThanDays'],
    [{ olderThanDays: 366 }, 'olderThanDays'],
    [{ olderThanDays: 2.5 }, 'olderThanDays'],
    [{ olderThanDays: '30' }, 'olderThanDays'],
    [{ after: 'nope' }, 'after'],
    [{ apply: true, surprise: 1 }, 'surprise'],
    ['not json', undefined],
    ['[1]', undefined],
  ];
  for (const [body, field] of cases) {
    const res = await sweep(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'MEDIA_SWEEP_BODY_INVALID');
    assert.equal(out.field, field, JSON.stringify(body));
  }
  assert.equal(media.length, 5);
  assert.deepEqual(destroyed, []);
});
