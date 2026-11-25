import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Media, Product, signSession, Store, StoreArticle, StorePage } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { settleRevalidations } from '../src/lib/revalidate';
import { findMediaUsage } from '../src/lib/media-usage';
import { pageToWire, templateCatalog } from '../src/lib/pages';

// Sprint 7 (S7-B3): the seller's page routes: lazy templates, reserved slugs, isolation, the revision compare-and-set, publishing, the media registry.
// Models are stubbed; no database. The storefront purge is observed through a stubbed fetch.

const SECRET = 'x'.repeat(40);
const oid = (n: number): string => n.toString(16).padStart(24, '0');
const USER_A = oid(1);
const USER_B = oid(2);
const ADMIN = oid(3);
const STORE_A = oid(11);
const STORE_B = oid(12);
const MEDIA_A = oid(101);
const MEDIA_B = oid(201);
const URL_A = 'https://cdn.test/a.png';
const URL_B = 'https://cdn.test/b.png';
const PAGE_A = oid(301);
const PAGE_B = oid(302);
const T0 = new Date('2026-11-01T10:00:00Z');
const RESERVED = ['products', 'cart', 'checkout', 'track', 'favourites', 'search', 'collections', 'blog', 'pages', 'account', 'api'];

const PageModel = StorePage as any;
const ArticleModel = StoreArticle as any;
const MediaModel = Media as any;
const ProductModel = Product as any;
const StoreModel = Store as any;
const AuditModel = AuditLog as any;

let pages: Array<Record<string, any>> = [];
let media: Array<Record<string, any>> = [];
let stores: Record<string, Record<string, any>> = {};
let audits: Array<Record<string, any>> = [];
let purges: string[] = [];
let updates: Array<{ filter: any; update: any }> = [];
let creates = 0;
let failNextUpdateWithDuplicate = false;
let nextId = 1000;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};

type Ctx = { params: Promise<{ id: string }> };
let collection: { GET: (r: NextRequest) => Promise<Response>; POST: (r: NextRequest) => Promise<Response> };
let fromTemplate: { POST: (r: NextRequest) => Promise<Response> };
let item: { GET: (r: NextRequest, c: Ctx) => Promise<Response>; PATCH: (r: NextRequest, c: Ctx) => Promise<Response>; DELETE: (r: NextRequest, c: Ctx) => Promise<Response> };

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  collection = (await import('../src/app/api/storePages/route')) as any;
  fromTemplate = (await import('../src/app/api/storePages/from-template/route')) as any;
  item = (await import('../src/app/api/storePages/[id]/route')) as any;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && '$in' in cond) return (cond.$in as unknown[]).map(String).includes(String(value));
    if (Array.isArray(value)) return value.map(String).includes(String(cond));
    return String(value) === String(cond);
  });
}

const page = (over: Record<string, any>): Record<string, any> => ({
  _id: oid(nextId++),
  store: STORE_A,
  title: 'A page',
  slug: 'a-page',
  body: 'text',
  status: 'draft',
  showInFooter: false,
  sortOrder: 0,
  revision: 0,
  mediaRefs: [],
  publishedAt: null,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

beforeEach(() => {
  pages = [
    page({ _id: PAGE_A, title: 'Size guide', slug: 'size-guide', body: 'Sizes' }),
    page({ _id: PAGE_B, store: STORE_B, title: 'Bilal secrets', slug: 'secrets', body: 'private' }),
  ];
  media = [
    { _id: MEDIA_A, store: STORE_A, url: URL_A },
    { _id: MEDIA_B, store: STORE_B, url: URL_B },
  ];
  stores = {
    [STORE_A]: { _id: STORE_A, owner: USER_A, slug: 'zara', storefront: {} },
    [STORE_B]: { _id: STORE_B, owner: USER_B, slug: 'bilal', storefront: {} },
  };
  audits = [];
  purges = [];
  updates = [];
  creates = 0;
  failNextUpdateWithDuplicate = false;
  process.env.STOREFRONT_URL = 'https://markazify.com';
  process.env.REVALIDATE_SECRET = 'r'.repeat(40);

  const saved = {
    connect: (mongoose as any).connect,
    fetch: globalThis.fetch,
    page: Object.fromEntries(['find', 'findOne', 'countDocuments', 'create', 'updateOne', 'deleteOne'].map((m) => [m, PageModel[m]])),
    article: Object.fromEntries(['find', 'countDocuments'].map((m) => [m, ArticleModel[m]])),
    media: Object.fromEntries(['find', 'findOne'].map((m) => [m, MediaModel[m]])),
    product: Object.fromEntries(['find', 'countDocuments'].map((m) => [m, ProductModel[m]])),
    store: Object.fromEntries(['findOne', 'findById', 'exists'].map((m) => [m, StoreModel[m]])),
    audit: AuditModel.create,
  };
  (mongoose as any).connect = async () => mongoose;
  globalThis.fetch = (async (url: string) => {
    purges.push(String(url));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  PageModel.findOne = (filter: any) => chain(() => structuredClone(pages.find((row) => matches(row, filter)) ?? null));
  PageModel.find = (filter: any) =>
    chain(() =>
      structuredClone(
        pages
          .filter((row) => matches(row, filter))
          .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.title).localeCompare(String(b.title))),
      ),
    );
  PageModel.countDocuments = async (filter: any) => pages.filter((row) => matches(row, filter)).length;
  PageModel.create = async (doc: Record<string, any>) => {
    creates += 1;
    if (pages.some((row) => String(row.store) === String(doc.store) && row.slug === doc.slug)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const row = { _id: oid(nextId++), ...structuredClone(doc), createdAt: T0, updatedAt: T0 };
    pages.push(row);
    return row;
  };
  PageModel.updateOne = async (filter: any, update: any) => {
    updates.push({ filter, update });
    if (failNextUpdateWithDuplicate) {
      failNextUpdateWithDuplicate = false;
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    const row = pages.find((r) => String(r._id) === String(filter._id) && String(r.store) === String(filter.store));
    if (!row) return { matchedCount: 0 };
    const want = filter.revision;
    const have = row.revision ?? null;
    const ok = want !== null && typeof want === 'object' && '$in' in want ? (want.$in as unknown[]).includes(have) : have === want;
    if (!ok) return { matchedCount: 0 };
    Object.assign(row, structuredClone(update.$set ?? {}));
    row.revision = (row.revision ?? 0) + (update.$inc?.revision ?? 0);
    row.updatedAt = new Date(T0.getTime() + 1000);
    return { matchedCount: 1 };
  };
  PageModel.deleteOne = async (filter: any) => {
    const index = pages.findIndex((r) => String(r._id) === String(filter._id) && String(r.store) === String(filter.store));
    if (index === -1) return { deletedCount: 0 };
    pages.splice(index, 1);
    return { deletedCount: 1 };
  };
  ArticleModel.countDocuments = async () => 0;
  ArticleModel.find = () => chain(() => []);
  MediaModel.findOne = (filter: any) => chain(() => structuredClone(media.find((row) => matches(row, filter)) ?? null));
  MediaModel.find = (filter: any) => chain(() => structuredClone(media.filter((row) => matches(row, filter))));
  ProductModel.countDocuments = async () => 0;
  ProductModel.find = () => chain(() => []);
  StoreModel.findOne = (filter: any) => chain(() => (stores[String(filter._id)] ? structuredClone(stores[String(filter._id)]) : null));
  StoreModel.findById = (id: unknown) => chain(() => (stores[String(id)] ? { slug: stores[String(id)]!.slug } : null));
  StoreModel.exists = async (filter: any) => (stores[String(filter._id)] && String(stores[String(filter._id)]!.owner) === String(filter.owner) ? { _id: filter._id } : null);
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    globalThis.fetch = saved.fetch;
    for (const [m, fn] of Object.entries(saved.page)) PageModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.article)) ArticleModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.media)) MediaModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.product)) ProductModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    AuditModel.create = saved.audit;
    delete process.env.STOREFRONT_URL;
    delete process.env.REVALIDATE_SECRET;
  };
});

afterEach(() => restore());

const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Opts = { token?: string | null; store?: string | null; body?: unknown; raw?: string };
function call(method: string, path: string, opts: Opts = {}): NextRequest {
  const { token = tokenA, store = STORE_A, body, raw } = opts;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = 'Bearer ' + token;
  if (store !== null) headers['x-store-id'] = store;
  return new NextRequest('http://seller.test/api/storePages' + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
}
const create = (body: unknown, opts: Opts = {}) => collection.POST(call('POST', '', { ...opts, body }));
const fromTpl = (body: unknown, opts: Opts = {}) => fromTemplate.POST(call('POST', '/from-template', { ...opts, body }));
const list = (opts: Opts = {}) => collection.GET(call('GET', '', opts));
const patch = (id: string, body: unknown, opts: Opts = {}) => item.PATCH(call('PATCH', '/' + id, { ...opts, body }), params(id));
const remove = (id: string, opts: Opts = {}) => item.DELETE(call('DELETE', '/' + id, opts), params(id));
const read = (id: string, opts: Opts = {}) => item.GET(call('GET', '/' + id, opts), params(id));
type Body = Record<string, any>;
const row = (id: string): Record<string, any> => pages.find((r) => r._id === id)!;
const stored = (slug: string): Record<string, any> => pages.find((r) => r.slug === slug && String(r.store) === STORE_A)!;

// ------------------------------------------------------------------------------------------------------------------------ lazy templates

test('GET lists the store\'s pages without their text and the five templates, and CREATES NOTHING', async () => {
  const res = await list();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.deepEqual(body.docs.map((d: Body) => d.slug), ['size-guide']);
  assert.ok(body.docs.every((d: Body) => !('body' in d) && !('mediaRefs' in d)), 'no text and no references in the list');
  assert.deepEqual(body.templates.map((t: Body) => [t.key, t.exists]), [['about', false], ['contact', false], ['shipping', false], ['returns', false], ['privacy', false]]);
  assert.equal(body.templates.find((t: Body) => t.key === 'privacy').legal, true);
  assert.equal(creates, 0, 'opening the manager made no page');
  assert.equal(pages.length, 2);
  assert.equal(audits.length, 0);
  // Asking twice changes nothing either.
  await list();
  assert.equal(creates, 0);
});

test('a template shows as existing once the store has a page at that address, and the catalogue helper is pure', async () => {
  pages.push(page({ slug: 'about', title: 'About us' }));
  const body = (await (await list()).json()) as Body;
  assert.equal(body.templates.find((t: Body) => t.key === 'about').exists, true);
  assert.equal(body.templates.find((t: Body) => t.key === 'contact').exists, false);
  assert.deepEqual(templateCatalog(['shipping']).filter((t) => t.exists).map((t) => t.key), ['shipping']);
});

test('POST from-template creates ONE draft page from the editable template: its text, its address, its footer setting, no purge', async () => {
  const res = await fromTpl({ template: 'contact' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Body;
  assert.equal(body.slug, 'contact');
  assert.equal(body.title, 'Contact us');
  assert.equal(body.status, 'draft');
  assert.equal(body.template, 'contact');
  assert.equal(body.showInFooter, true);
  assert.equal(body.revision, 0);
  assert.equal(body.publishedAt, null);
  assert.match(body.body, /Contact us/);
  assert.equal(body.hasPlaceholder, true, 'the template still needs editing');
  assert.equal('mediaRefs' in body, false);
  assert.equal(creates, 1, 'only the page that was asked for');
  assert.equal(String(stored('contact').store), STORE_A);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'page.create');
  await settleRevalidations();
  assert.equal(purges.length, 0, 'a draft changes nothing a shopper sees');
});

test('from-template: every template can be made, once; asking again is 409 PAGE_SLUG_TAKEN and writes nothing', async () => {
  for (const key of ['about', 'contact', 'shipping', 'returns', 'privacy']) assert.equal((await fromTpl({ template: key })).status, 201, key);
  assert.equal(creates, 5);
  const again = await fromTpl({ template: 'about' });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as Body).code, 'PAGE_SLUG_TAKEN');
  assert.equal(creates, 5);
  // The same template in another store is another page.
  assert.equal((await fromTpl({ template: 'about' }, { token: tokenB, store: STORE_B })).status, 201);
});

test('from-template: an unknown template is 400 PAGE_TEMPLATE_UNKNOWN, a bad or strict body is 400 PAGE_INVALID with the field, nothing is created', async () => {
  const unknown = await fromTpl({ template: 'terms' });
  assert.equal(unknown.status, 400);
  const out = (await unknown.json()) as Body;
  assert.equal(out.code, 'PAGE_TEMPLATE_UNKNOWN');
  assert.equal(out.field, 'template');
  const cases: Array<[unknown, string]> = [
    [{}, 'template'],
    [{ template: '' }, 'template'],
    [{ template: 5 }, 'template'],
    [{ template: 'about', title: 'Mine' }, 'title'],
    [{ template: 'about', store: STORE_B }, 'store'],
    [{ template: 'about', body: 'x' }, 'body'],
  ];
  for (const [body, field] of cases) {
    const res = await fromTpl(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const e = (await res.json()) as Body;
    assert.equal(e.code, 'PAGE_INVALID', JSON.stringify(body));
    assert.equal(e.field, field, JSON.stringify(body));
  }
  assert.equal((await fromTemplate.POST(call('POST', '/from-template', { raw: 'not json' }))).status, 400);
  assert.equal(creates, 0);
});

test('from-template: no session 401, admin 403, another seller\'s store 403, a missing store header 400', async () => {
  assert.equal((await fromTpl({ template: 'about' }, { token: null })).status, 401);
  assert.equal((await fromTpl({ template: 'about' }, { token: tokenAdmin })).status, 403);
  assert.equal((await fromTpl({ template: 'about' }, { token: tokenB, store: STORE_A })).status, 403);
  assert.equal((await fromTpl({ template: 'about' }, { store: null })).status, 400);
  assert.equal(creates, 0);
});

// ------------------------------------------------------------------------------------------------------------------------- create, reserved

test('POST creates a draft page: revision 0, no publish date, nothing purged; published sets the date and purges', async () => {
  const draft = await create({ title: 'Size chart', body: '# Sizes\n\n- S\n- M' });
  assert.equal(draft.status, 201);
  const body = (await draft.json()) as Body;
  assert.equal(body.slug, 'size-chart');
  assert.equal(body.status, 'draft');
  assert.equal(body.showInFooter, false);
  assert.equal(body.sortOrder, 0);
  assert.equal(body.publishedAt, null);
  assert.equal(body.hasPlaceholder, false);
  await settleRevalidations();
  assert.equal(purges.length, 0);
  const live = await create({ title: 'Warranty', slug: 'warranty', status: 'published', showInFooter: true, sortOrder: 5 });
  assert.equal(live.status, 201);
  const liveBody = (await live.json()) as Body;
  assert.ok(typeof liveBody.publishedAt === 'string');
  assert.equal(liveBody.sortOrder, 5);
  await settleRevalidations();
  assert.ok(purges.length >= 1);
});

test('POST refuses a bad body with 400 PAGE_INVALID and the field, and creates nothing', async () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'title'],
    [{ title: 'a' }, 'title'],
    [{ title: 'x'.repeat(121) }, 'title'],
    [{ title: 'Fine', slug: 'Bad Slug' }, 'slug'],
    [{ title: 'Fine', body: 'x'.repeat(50001) }, 'body'],
    [{ title: 'Fine', status: 'archived' }, 'status'],
    [{ title: 'Fine', showInFooter: 'yes' }, 'showInFooter'],
    [{ title: 'Fine', sortOrder: -1 }, 'sortOrder'],
    [{ title: 'Fine', sortOrder: 10000 }, 'sortOrder'],
    [{ title: 'Fine', store: STORE_B }, 'store'],
    [{ title: 'Fine', revision: 0 }, 'revision'],
    [{ title: 'Fine', mediaRefs: [MEDIA_B] }, 'mediaRefs'],
    [{ title: 'Fine', publishedAt: '2026-01-01T00:00:00Z' }, 'publishedAt'],
  ];
  for (const [body, field] of cases) {
    const res = await create(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'PAGE_INVALID');
    assert.equal(out.field, field, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await create(undefined, { raw: 'not json' })).status, 400);
  assert.equal(creates, 0);
});

test('reserved slugs are refused on create, typed or taken from the title: 400 PAGE_SLUG_RESERVED on the slug field', async () => {
  for (const word of RESERVED) {
    const typed = await create({ title: 'Some page', slug: word });
    assert.equal(typed.status, 400, word);
    const out = (await typed.json()) as Body;
    assert.equal(out.code, 'PAGE_SLUG_RESERVED', word);
    assert.equal(out.field, 'slug', word);
    const fromTitle = await create({ title: word.charAt(0).toUpperCase() + word.slice(1) });
    assert.equal(fromTitle.status, 400, 'title ' + word);
    assert.equal(((await fromTitle.json()) as Body).code, 'PAGE_SLUG_RESERVED', 'title ' + word);
  }
  assert.equal(creates, 0);
  // Words that only contain a reserved word are fine.
  assert.equal((await create({ title: 'Blog rules', slug: 'blog-rules' })).status, 201);
  assert.equal((await create({ title: 'Cart help', slug: 'my-cart' })).status, 201);
});

test('POST: the web address comes from the title; an Urdu-only title needs one typed; a taken slug is 409, a race on the index too', async () => {
  const urdu = await create({ title: 'ہمارے بارے میں' });
  assert.equal(urdu.status, 400);
  assert.equal(((await urdu.json()) as Body).field, 'slug');
  assert.equal((await create({ title: 'ہمارے بارے میں', slug: 'hamare-bare-mein' })).status, 201);
  const dup = await create({ title: 'Other', slug: 'size-guide' });
  assert.equal(dup.status, 409);
  assert.equal(((await dup.json()) as Body).code, 'PAGE_SLUG_TAKEN');
  assert.equal((await create({ title: 'Size guide', slug: 'size-guide' }, { token: tokenB, store: STORE_B })).status, 201, 'another store may use it');
  const original = PageModel.findOne;
  PageModel.findOne = (filter: any) => (filter.slug === 'raced' ? chain(() => null) : original(filter));
  assert.equal((await create({ title: 'Raced', slug: 'raced' })).status, 201);
  assert.equal((await create({ title: 'Raced', slug: 'raced' })).status, 409);
  PageModel.findOne = original;
});

test('POST: no session 401, admin 403, another seller\'s store 403, a missing store header 400', async () => {
  assert.equal((await create({ title: 'Fine page' }, { token: null })).status, 401);
  assert.equal((await create({ title: 'Fine page' }, { token: tokenAdmin })).status, 403);
  assert.equal((await create({ title: 'Fine page' }, { token: tokenB, store: STORE_A })).status, 403);
  assert.equal((await create({ title: 'Fine page' }, { store: null })).status, 400);
  assert.equal(creates, 0);
});

test('page images must be the store\'s own media, and are recorded for the registry', async () => {
  const ok = await create({ title: 'With picture', body: '![x](' + URL_A + ')\n\n![again](' + URL_A + ')' });
  assert.equal(ok.status, 201);
  assert.deepEqual(stored('with-picture').mediaRefs, [MEDIA_A]);
  const foreign = await create({ title: 'Foreign picture', body: '![x](' + URL_B + ')' });
  assert.equal(foreign.status, 400);
  assert.equal(((await foreign.json()) as Body).field, 'body');
  const stranger = await create({ title: 'Stranger picture', body: '![x](https://evil.test/x.png)' });
  assert.equal(((await stranger.json()) as Body).field, 'body');
  assert.equal(creates, 1);
});

// --------------------------------------------------------------------------------------------------------------------------------- update

test('PATCH changes only what is sent, adds one to the revision, and is ONE compare-and-set write on the revision', async () => {
  const res = await patch(PAGE_A, { revision: 0, title: 'Size chart', showInFooter: true, sortOrder: 4 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.title, 'Size chart');
  assert.equal(body.slug, 'size-guide', 'a new title keeps the address');
  assert.equal(body.revision, 1);
  assert.equal(body.showInFooter, true);
  assert.equal(body.sortOrder, 4);
  assert.equal(body.body, 'Sizes', 'what was not sent is untouched');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]!.filter, { _id: PAGE_A, store: STORE_A, revision: { $in: [0, null] } });
  assert.deepEqual(updates[0]!.update.$inc, { revision: 1 });
  assert.equal(audits.at(-1)!.action, 'page.update');
});

test('PATCH on an older version is 409 PAGE_REVISION_CONFLICT with the current revision, and writes nothing', async () => {
  assert.equal((await patch(PAGE_A, { revision: 0, title: 'First edit' })).status, 200);
  const stale = await patch(PAGE_A, { revision: 0, title: 'Edit from an old tab' });
  assert.equal(stale.status, 409);
  const body = (await stale.json()) as Body;
  assert.equal(body.code, 'PAGE_REVISION_CONFLICT');
  assert.equal(body.currentRevision, 1);
  assert.equal(row(PAGE_A).title, 'First edit');
  assert.equal((await patch(PAGE_A, { revision: 1, title: 'Second edit' })).status, 200);
  assert.equal((await patch(PAGE_A, { revision: 9, title: 'Nope' })).status, 409);
  delete row(PAGE_A).revision;
  assert.equal((await patch(PAGE_A, { revision: 0, title: 'Legacy edit' })).status, 200, 'a row with no revision reads as 0');
});

test('PATCH: a bad body is 400 PAGE_INVALID with the field; the revision is required; other keys are refused', async () => {
  const cases: Array<[unknown, string]> = [
    [{ title: 'No revision' }, 'revision'],
    [{ revision: -1, title: 'Negative' }, 'revision'],
    [{ revision: 0 }, 'revision'],
    [{ revision: 0, title: 'x' }, 'title'],
    [{ revision: 0, slug: 'Bad Slug' }, 'slug'],
    [{ revision: 0, body: 'x'.repeat(50001) }, 'body'],
    [{ revision: 0, status: 'archived' }, 'status'],
    [{ revision: 0, sortOrder: 99999 }, 'sortOrder'],
    [{ revision: 0, store: STORE_B }, 'store'],
    [{ revision: 0, mediaRefs: [] }, 'mediaRefs'],
    [{ revision: 0, template: 'about' }, 'template'],
    [{ revision: 0, publishedAt: '2026-01-01T00:00:00Z' }, 'publishedAt'],
  ];
  for (const [body, field] of cases) {
    const res = await patch(PAGE_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'PAGE_INVALID');
    assert.equal(out.field, field, JSON.stringify(body));
  }
  assert.equal(updates.length, 0);
});

test('PATCH: a reserved word cannot become the address, a taken address is 409, the page\'s own address is fine', async () => {
  pages.push(page({ title: 'Second', slug: 'second' }));
  for (const word of RESERVED) {
    const res = await patch(PAGE_A, { revision: 0, slug: word });
    assert.equal(res.status, 400, word);
    assert.equal(((await res.json()) as Body).code, 'PAGE_SLUG_RESERVED', word);
  }
  assert.equal(row(PAGE_A).slug, 'size-guide');
  const clash = await patch(PAGE_A, { revision: 0, slug: 'second' });
  assert.equal(clash.status, 409);
  assert.equal(((await clash.json()) as Body).code, 'PAGE_SLUG_TAKEN');
  assert.equal((await patch(PAGE_A, { revision: 0, slug: 'size-guide' })).status, 200);
  assert.equal((await patch(PAGE_A, { revision: 1, slug: 'sizes' })).status, 200);
  failNextUpdateWithDuplicate = true;
  assert.equal((await patch(PAGE_A, { revision: 2, slug: 'sizes-2' })).status, 409);
});

test('publish and unpublish: publishedAt is set the first time and kept, each is audited, the storefront is purged when a published page is involved', async () => {
  assert.equal((await patch(PAGE_A, { revision: 0, body: 'Draft edit' })).status, 200);
  await settleRevalidations();
  assert.equal(purges.length, 0, 'editing a draft purges nothing');
  const published = (await (await patch(PAGE_A, { revision: 1, status: 'published' })).json()) as Body;
  const firstDate = published.publishedAt as string;
  assert.ok(typeof firstDate === 'string');
  assert.equal(audits.at(-1)!.action, 'page.publish');
  await settleRevalidations();
  const afterPublish = purges.length;
  assert.ok(afterPublish >= 1);
  const unpublished = (await (await patch(PAGE_A, { revision: 2, status: 'draft' })).json()) as Body;
  assert.equal(unpublished.publishedAt, firstDate);
  assert.equal(audits.at(-1)!.action, 'page.unpublish');
  await settleRevalidations();
  assert.ok(purges.length > afterPublish, 'unpublishing purges: the page must go away');
  assert.equal(((await (await patch(PAGE_A, { revision: 3, status: 'published' })).json()) as Body).publishedAt, firstDate);
});

test('PATCH: the body is checked again against the media library and recorded again; the placeholder flag follows the text', async () => {
  assert.equal((await patch(PAGE_A, { revision: 0, body: '![x](' + URL_A + ') [[EDIT: your number]]' })).status, 200);
  assert.deepEqual(row(PAGE_A).mediaRefs, [MEDIA_A]);
  assert.equal(((await (await read(PAGE_A)).json()) as Body).hasPlaceholder, true);
  assert.equal((await patch(PAGE_A, { revision: 1, title: 'Only the title' })).status, 200);
  assert.deepEqual(row(PAGE_A).mediaRefs, [MEDIA_A], 'untouched');
  const edited = (await (await patch(PAGE_A, { revision: 2, body: 'No picture, no placeholder' })).json()) as Body;
  assert.equal(edited.hasPlaceholder, false);
  assert.deepEqual(row(PAGE_A).mediaRefs, [], 'the removed picture is no longer referenced');
  const foreign = await patch(PAGE_A, { revision: 3, body: '![x](' + URL_B + ')' });
  assert.equal(foreign.status, 400);
  assert.equal(((await foreign.json()) as Body).field, 'body');
  assert.equal(row(PAGE_A).revision, 3);
});

// --------------------------------------------------------------------------------------------------------------------------- isolation

test('Seller B cannot read, write or delete Seller A\'s page: A\'s store id is 403, A\'s page under B\'s own store is 404, and nothing changes', async () => {
  const asA = { token: tokenB, store: STORE_A };
  const underB = { token: tokenB, store: STORE_B };
  assert.equal((await read(PAGE_A, asA)).status, 403);
  const peek = await read(PAGE_A, underB);
  assert.equal(peek.status, 404);
  assert.equal((await peek.text()).includes('Size guide'), false);
  assert.equal((await patch(PAGE_A, { revision: 0, title: 'Hijacked' }, asA)).status, 403);
  assert.equal((await patch(PAGE_A, { revision: 0, title: 'Hijacked' }, underB)).status, 404);
  assert.equal((await remove(PAGE_A, asA)).status, 403);
  assert.equal((await remove(PAGE_A, underB)).status, 404);
  assert.equal(updates.length, 0);
  assert.equal(row(PAGE_A).title, 'Size guide');
  assert.equal(pages.length, 2);
  assert.equal(audits.length, 0);
  assert.equal((await patch(PAGE_B, { revision: 0, title: 'Mine now' }, { token: tokenA, store: STORE_A })).status, 404);
  assert.equal((await patch(PAGE_B, { revision: 0, title: 'Mine now' }, underB)).status, 200);
  const mine = (await (await list(underB)).json()) as Body;
  assert.deepEqual(mine.docs.map((d: Body) => d.slug), ['secrets']);
  assert.equal((await list({ token: tokenB, store: STORE_A })).status, 403);
});

test('PATCH and DELETE: no session 401, an admin 403, a bad id 404, an unknown id 404', async () => {
  assert.equal((await patch(PAGE_A, { revision: 0, title: 'Anyone' }, { token: null })).status, 401);
  assert.equal((await patch(PAGE_A, { revision: 0, title: 'Admin edit' }, { token: tokenAdmin })).status, 403);
  assert.equal((await remove(PAGE_A, { token: null })).status, 401);
  assert.equal((await remove(PAGE_A, { token: tokenAdmin })).status, 403);
  assert.equal((await list({ token: tokenAdmin })).status, 403);
  assert.equal((await patch('not-an-id', { revision: 0, title: 'Nothing here' })).status, 404);
  assert.equal((await remove('not-an-id')).status, 404);
  assert.equal((await patch(oid(999), { revision: 0, title: 'Nothing here' })).status, 404);
  assert.equal(updates.length, 0);
  assert.equal(pages.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------- delete

test('DELETE removes the page, audits it, purges only when it was published, and a second delete is 404', async () => {
  const draft = await remove(PAGE_A);
  assert.equal(draft.status, 200);
  assert.deepEqual(await draft.json(), { deleted: true, id: PAGE_A });
  assert.equal(audits.at(-1)!.action, 'page.delete');
  await settleRevalidations();
  assert.equal(purges.length, 0);
  assert.equal((await remove(PAGE_A)).status, 404);
  pages.push(page({ _id: oid(310), slug: 'live', title: 'Live', status: 'published', publishedAt: T0 }));
  assert.equal((await remove(oid(310))).status, 200);
  await settleRevalidations();
  assert.ok(purges.length >= 1);
});

// ------------------------------------------------------------------------------------------------------------------- the media registry

test('an image a page uses can never be deleted: the registry lists the page; it is free again once the page is gone', async () => {
  assert.equal((await create({ title: 'Uses a picture', body: '![x](' + URL_A + ')' })).status, 201);
  const used = await findMediaUsage(STORE_A, MEDIA_A);
  assert.equal(used.inUse, true);
  assert.deepEqual(used.features.map((f) => [f.key, f.label, f.count]), [['pages', 'Pages', 1]]);
  assert.equal(used.features[0]!.items[0]!.title, 'Uses a picture');
  assert.equal((await findMediaUsage(STORE_A, oid(999))).inUse, false);
  pages = pages.filter((r) => r.slug !== 'uses-a-picture');
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A)).inUse, false);
  pages.push(page({ store: STORE_B, slug: 'b-uses', mediaRefs: [MEDIA_A] }));
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A)).inUse, false, 'another store\'s page never makes this store\'s file look used');
});

test('the wire form strips the references, defaults the new fields, and flags a placeholder', () => {
  const wire = pageToWire({ _id: 'x', body: 'Call [[EDIT: number]]', mediaRefs: [MEDIA_A] });
  assert.equal('mediaRefs' in wire, false);
  assert.equal(wire.revision, 0);
  assert.equal(wire.sortOrder, 0);
  assert.equal(wire.showInFooter, false);
  assert.equal(wire.hasPlaceholder, true);
  assert.equal('body' in pageToWire({ _id: 'x', body: 'text' }, { withBody: false }), false);
  assert.equal(pageToWire({ _id: 'x' }).body, '');
});
