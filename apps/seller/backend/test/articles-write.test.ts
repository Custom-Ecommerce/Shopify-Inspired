import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, Media, Product, signSession, Store, StoreArticle, StorePage } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { settleRevalidations } from '../src/lib/revalidate';
import { findMediaUsage } from '../src/lib/media-usage';
import { articleContentText, articleSlugFromTitle, articleToWire } from '../src/lib/articles';
import { publicArticleFilter, toStorefrontArticle } from '../src/lib/storefront/article-dto';

// Sprint 7 (S7-B2, CO-116): the seller's article write routes, isolation, the revision compare-and-set, publishing, the media registry and the shopper's
// view. Models are stubbed; no database. The storefront purge is observed through a stubbed fetch.

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
const URL_A2 = 'https://cdn.test/a2.png';
const URL_B = 'https://cdn.test/b.png';
const MEDIA_A2 = oid(102);
const ART_A = oid(301);
const ART_B = oid(302);
const T0 = new Date('2026-11-01T10:00:00Z');

const ArticleModel = StoreArticle as any;
const PageModel = StorePage as any;
const MediaModel = Media as any;
const ProductModel = Product as any;
const StoreModel = Store as any;
const AuditModel = AuditLog as any;

let articles: Array<Record<string, any>> = [];
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
let item: { GET: (r: NextRequest, c: Ctx) => Promise<Response>; PATCH: (r: NextRequest, c: Ctx) => Promise<Response>; DELETE: (r: NextRequest, c: Ctx) => Promise<Response> };
let mediaItem: { DELETE: (r: NextRequest, c: Ctx) => Promise<Response> };

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: USER_A, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: USER_B, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  collection = (await import('../src/app/api/storeArticles/route')) as any;
  item = (await import('../src/app/api/storeArticles/[id]/route')) as any;
  mediaItem = (await import('../src/app/api/media/[id]/route')) as any;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && '$regex' in cond) return new RegExp(cond.$regex, 'i').test(String(value ?? ''));
    if (cond !== null && typeof cond === 'object' && '$in' in cond) return (cond.$in as unknown[]).map(String).includes(String(value));
    if (Array.isArray(value)) return value.map(String).includes(String(cond));
    return String(value) === String(cond);
  });
}

beforeEach(() => {
  articles = [
    { _id: ART_A, store: STORE_A, type: 'blog', title: 'Eid collection', slug: 'eid-collection', excerpt: null, content: 'Hello **world**', status: 'draft', publishedAt: null, tags: [], revision: 0, mediaRefs: [], createdAt: T0, updatedAt: T0 },
    { _id: ART_B, store: STORE_B, type: 'blog', title: 'Bilal secrets', slug: 'secrets', excerpt: null, content: 'private', status: 'draft', publishedAt: null, tags: [], revision: 0, mediaRefs: [], createdAt: T0, updatedAt: T0 },
  ];
  media = [
    { _id: MEDIA_A, store: STORE_A, url: URL_A },
    { _id: MEDIA_A2, store: STORE_A, url: URL_A2 },
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
    article: Object.fromEntries(['find', 'findOne', 'countDocuments', 'create', 'updateOne', 'deleteOne'].map((m) => [m, ArticleModel[m]])),
    media: Object.fromEntries(['find', 'findOne'].map((m) => [m, MediaModel[m]])),
    product: Object.fromEntries(['find', 'countDocuments'].map((m) => [m, ProductModel[m]])),
    store: Object.fromEntries(['findOne', 'findById', 'exists'].map((m) => [m, StoreModel[m]])),
    audit: AuditModel.create,
    page: Object.fromEntries(['countDocuments', 'find'].map((m) => [m, PageModel[m]])),
  };
  (mongoose as any).connect = async () => mongoose;
  globalThis.fetch = (async (url: string) => {
    purges.push(String(url));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  ArticleModel.findOne = (filter: any) => chain(() => structuredClone(articles.find((row) => matches(row, filter)) ?? null));
  ArticleModel.find = (filter: any) =>
    chain(() => structuredClone(articles.filter((row) => matches(row, filter)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())));
  ArticleModel.countDocuments = async (filter: any) => articles.filter((row) => matches(row, filter)).length;
  ArticleModel.create = async (doc: Record<string, any>) => {
    creates += 1;
    if (articles.some((row) => String(row.store) === String(doc.store) && row.slug === doc.slug)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const row = { _id: oid(nextId++), ...structuredClone(doc), createdAt: T0, updatedAt: T0 };
    articles.push(row);
    return row;
  };
  ArticleModel.updateOne = async (filter: any, update: any) => {
    updates.push({ filter, update });
    if (failNextUpdateWithDuplicate) {
      failNextUpdateWithDuplicate = false;
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    const row = articles.find((r) => String(r._id) === String(filter._id) && String(r.store) === String(filter.store));
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
  ArticleModel.deleteOne = async (filter: any) => {
    const index = articles.findIndex((r) => String(r._id) === String(filter._id) && String(r.store) === String(filter.store));
    if (index === -1) return { deletedCount: 0 };
    articles.splice(index, 1);
    return { deletedCount: 1 };
  };
  MediaModel.findOne = (filter: any) => chain(() => structuredClone(media.find((row) => matches(row, filter)) ?? null));
  MediaModel.find = (filter: any) => chain(() => structuredClone(media.filter((row) => matches(row, filter))));
  // Sprint 7 (S7-B3): the registry also asks the pages feature; no page uses any file in this test.
  PageModel.countDocuments = async () => 0;
  PageModel.find = () => chain(() => []);
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
    for (const [m, fn] of Object.entries(saved.article)) ArticleModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.media)) MediaModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.product)) ProductModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    AuditModel.create = saved.audit;
    for (const [m, fn] of Object.entries(saved.page)) PageModel[m] = fn;
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
  return new NextRequest('http://seller.test/api/storeArticles' + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
}
const create = (body: unknown, opts: Opts = {}) => collection.POST(call('POST', '', { ...opts, body }));
const patch = (id: string, body: unknown, opts: Opts = {}) => item.PATCH(call('PATCH', '/' + id, { ...opts, body }), params(id));
const remove = (id: string, opts: Opts = {}) => item.DELETE(call('DELETE', '/' + id, opts), params(id));
const read = (id: string, opts: Opts = {}) => item.GET(call('GET', '/' + id, opts), params(id));
const list = (query = '', opts: Opts = {}) => collection.GET(call('GET', query, opts));
type Body = Record<string, any>;
const row = (id: string): Record<string, any> => articles.find((r) => r._id === id)!;
const stored = (slug: string): Record<string, any> => articles.find((r) => r.slug === slug && String(r.store) === STORE_A)!;

// ---------------------------------------------------------------------------------------------------------------------------------- create

test('POST creates a draft in the verified store: revision 0, no publish date, no purge, audited', async () => {
  const res = await create({ title: 'Summer lookbook', content: '# Hello\n\nWorld', tags: ['summer', 'lawn'], seoTitle: 'Summer', excerpt: 'A short one' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Body;
  assert.equal(body.title, 'Summer lookbook');
  assert.equal(body.slug, 'summer-lookbook');
  assert.equal(body.status, 'draft');
  assert.equal(body.type, 'blog');
  assert.equal(body.revision, 0);
  assert.equal(body.publishedAt, null);
  assert.equal(body.content, '# Hello\n\nWorld');
  assert.deepEqual(body.tags, ['summer', 'lawn']);
  assert.equal('mediaRefs' in body, false, 'the server-only references are never sent');
  const made = stored('summer-lookbook');
  assert.equal(String(made.store), STORE_A, 'the store comes from the verified store, never the body');
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'article.create');
  await settleRevalidations();
  assert.equal(purges.length, 0, 'a draft changes nothing a shopper sees');
});

test('POST published sets the publish date and purges the storefront; a given slug is kept', async () => {
  const res = await create({ title: 'Eid sale', slug: 'eid-sale-2026', status: 'published' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Body;
  assert.equal(body.slug, 'eid-sale-2026');
  assert.equal(body.status, 'published');
  assert.ok(typeof body.publishedAt === 'string' && !Number.isNaN(Date.parse(body.publishedAt)));
  await settleRevalidations();
  assert.ok(purges.length >= 1);
});

test('POST refuses a bad body with 400 ARTICLE_INVALID and the field, and creates nothing', async () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'title'],
    [{ title: 'ab' }, 'title'],
    [{ title: 'x'.repeat(121) }, 'title'],
    [{ title: 'Fine title', slug: 'Bad Slug' }, 'slug'],
    [{ title: 'Fine title', slug: '-dash' }, 'slug'],
    [{ title: 'Fine title', content: 'x'.repeat(50001) }, 'content'],
    [{ title: 'Fine title', excerpt: 'x'.repeat(161) }, 'excerpt'],
    [{ title: 'Fine title', tags: Array.from({ length: 11 }, (_, i) => 't' + i) }, 'tags'],
    [{ title: 'Fine title', tags: ['a', 'A'] }, 'tags'],
    [{ title: 'Fine title', status: 'archived' }, 'status'],
    [{ title: 'Fine title', type: 'lookbook' }, 'type'],
    [{ title: 'Fine title', seoTitle: 'x'.repeat(71) }, 'seoTitle'],
    [{ title: 'Fine title', seoDescription: 'x'.repeat(161) }, 'seoDescription'],
    [{ title: 'Fine title', coverImage: 'not-an-id-or-url' }, 'coverImage'],
    [{ title: 'Fine title', coverImage: 'http://cdn.test/a.png' }, 'coverImage'],
    [{ title: 'Fine title', store: STORE_B }, 'store'],
    [{ title: 'Fine title', publishedAt: '2026-01-01T00:00:00Z' }, 'publishedAt'],
    [{ title: 'Fine title', revision: 3 }, 'revision'],
    [{ title: 'Fine title', mediaRefs: [MEDIA_B] }, 'mediaRefs'],
  ];
  for (const [body, field] of cases) {
    const res = await create(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'ARTICLE_INVALID');
    assert.equal(out.field, field, JSON.stringify(body).slice(0, 80));
  }
  const notJson = await create(undefined, { raw: 'not json' });
  assert.equal(notJson.status, 400);
  assert.equal(((await notJson.json()) as Body).code, 'ARTICLE_INVALID');
  assert.equal(creates, 0);
});

test('POST: the web address comes from the title; a title with no Latin letter needs one typed (400 slug)', async () => {
  assert.equal(articleSlugFromTitle('  Eid Mubarak!  '), 'eid-mubarak');
  const urdu = await create({ title: 'عید مبارک ہو' });
  assert.equal(urdu.status, 400);
  assert.equal(((await urdu.json()) as Body).field, 'slug');
  assert.equal((await create({ title: 'عید مبارک ہو', slug: 'eid-mubarak' })).status, 201);
  assert.equal(creates, 1);
});

test('POST: a slug already used in this store is 409 ARTICLE_SLUG_TAKEN, the same slug in another store is fine, and a race on the unique index is 409 too', async () => {
  const dup = await create({ title: 'Another one', slug: 'eid-collection' });
  assert.equal(dup.status, 409);
  const body = (await dup.json()) as Body;
  assert.equal(body.code, 'ARTICLE_SLUG_TAKEN');
  assert.equal(body.field, 'slug');
  assert.equal(creates, 0, 'the check came first');
  // Store B may use a slug that store A has.
  assert.equal((await create({ title: 'Eid collection', slug: 'eid-collection' }, { token: tokenB, store: STORE_B })).status, 201);
  // The unique index is the last word: a duplicate key from the database is a 409, not a 500.
  const original = ArticleModel.findOne;
  ArticleModel.findOne = (filter: any) => (filter.slug === 'raced' ? chain(() => null) : original(filter));
  assert.equal((await create({ title: 'Raced', slug: 'raced' })).status, 201);
  assert.equal((await create({ title: 'Raced', slug: 'raced' })).status, 409);
  ArticleModel.findOne = original;
});

test('POST: no session is 401, an admin is 403, another seller\'s store is 403, and a missing store header is 400 (the store must be named)', async () => {
  assert.equal((await create({ title: 'Fine title' }, { token: null })).status, 401);
  assert.equal((await create({ title: 'Fine title' }, { token: tokenAdmin })).status, 403);
  assert.equal((await create({ title: 'Fine title' }, { token: tokenB, store: STORE_A })).status, 403);
  const noStore = await create({ title: 'Fine title' }, { store: null });
  assert.equal(noStore.status, 400);
  assert.equal(creates, 0);
});

test('POST: the cover and the pictures in the text must come from the store\'s own media, and are recorded for the media registry', async () => {
  const ok = await create({ title: 'With pictures', coverImage: MEDIA_A, content: '![one](' + URL_A2 + ')\n\ntext ![again](' + URL_A2 + ')' });
  assert.equal(ok.status, 201);
  const made = stored('with-pictures');
  assert.equal(String(made.coverImage), MEDIA_A);
  assert.deepEqual([...made.mediaRefs].sort(), [MEDIA_A, MEDIA_A2].sort(), 'the cover and the inline image, once each');

  const byUrl = await create({ title: 'Cover by address', coverImage: URL_A });
  assert.equal(byUrl.status, 201);
  assert.equal(String(stored('cover-by-address').coverImage), MEDIA_A, 'an address of the store\'s media is stored as its id');

  const foreignId = await create({ title: 'Foreign id', coverImage: MEDIA_B });
  assert.equal(foreignId.status, 400);
  assert.equal(((await foreignId.json()) as Body).field, 'coverImage');
  const foreignUrl = await create({ title: 'Foreign url', coverImage: URL_B });
  assert.equal(foreignUrl.status, 400);
  assert.equal(((await foreignUrl.json()) as Body).field, 'coverImage');
  const strangerUrl = await create({ title: 'Stranger', coverImage: 'https://evil.test/x.png' });
  assert.equal(((await strangerUrl.json()) as Body).field, 'coverImage');
  const inlineStranger = await create({ title: 'Inline stranger', content: '![x](https://evil.test/x.png)' });
  assert.equal(inlineStranger.status, 400);
  assert.equal(((await inlineStranger.json()) as Body).field, 'content');
  const inlineForeign = await create({ title: 'Inline foreign', content: '![x](' + URL_B + ')' });
  assert.equal(inlineForeign.status, 400);
  assert.equal(creates, 2, 'only the two good ones were written');
});

// ----------------------------------------------------------------------------------------------------------------------------------- update

test('PATCH changes only what is sent, adds one to the revision, and is ONE compare-and-set write on the revision', async () => {
  const res = await patch(ART_A, { revision: 0, title: 'Eid collection 2026', tags: ['eid'] });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.title, 'Eid collection 2026');
  assert.equal(body.slug, 'eid-collection', 'the web address is not changed by a new title');
  assert.equal(body.revision, 1);
  assert.deepEqual(body.tags, ['eid']);
  assert.equal(body.content, 'Hello **world**', 'what was not sent is untouched');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]!.filter, { _id: ART_A, store: STORE_A, revision: { $in: [0, null] } });
  assert.deepEqual(updates[0]!.update.$inc, { revision: 1 });
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'article.update');
});

test('PATCH on an older version is 409 ARTICLE_REVISION_CONFLICT with the current revision, and writes nothing', async () => {
  assert.equal((await patch(ART_A, { revision: 0, title: 'First edit' })).status, 200);
  const stale = await patch(ART_A, { revision: 0, title: 'Second edit from an old tab' });
  assert.equal(stale.status, 409);
  const body = (await stale.json()) as Body;
  assert.equal(body.code, 'ARTICLE_REVISION_CONFLICT');
  assert.equal(body.currentRevision, 1);
  assert.equal(row(ART_A).title, 'First edit', 'the stale save changed nothing');
  assert.equal(row(ART_A).revision, 1);
  // The same edit made on the current version works.
  assert.equal((await patch(ART_A, { revision: 1, title: 'Second edit' })).status, 200);
  assert.equal(row(ART_A).revision, 2);
  // A revision from the future is a conflict too.
  assert.equal((await patch(ART_A, { revision: 9, title: 'Nope' })).status, 409);
});

test('PATCH: a row from before revisions existed (no revision) is edited with revision 0 and gets one', async () => {
  delete row(ART_A).revision;
  assert.equal((await patch(ART_A, { revision: 0, title: 'Legacy edit' })).status, 200);
  assert.equal(row(ART_A).revision, 1);
});

test('PATCH: a bad body is 400 ARTICLE_INVALID with the field: the revision is required, other keys are refused, nothing to change is refused', async () => {
  const cases: Array<[unknown, string]> = [
    [{ title: 'No revision' }, 'revision'],
    [{ revision: -1, title: 'Negative' }, 'revision'],
    [{ revision: '0', title: 'String' }, 'revision'],
    [{ revision: 0 }, 'revision'],
    [{ revision: 0, title: 'x' }, 'title'],
    [{ revision: 0, slug: 'Not A Slug' }, 'slug'],
    [{ revision: 0, content: 'x'.repeat(50001) }, 'content'],
    [{ revision: 0, status: 'archived' }, 'status'],
    [{ revision: 0, store: STORE_B }, 'store'],
    [{ revision: 0, publishedAt: '2026-01-01T00:00:00Z' }, 'publishedAt'],
    [{ revision: 0, mediaRefs: [] }, 'mediaRefs'],
    [{ revision: 0, coverImage: 'nope' }, 'coverImage'],
  ];
  for (const [body, field] of cases) {
    const res = await patch(ART_A, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const out = (await res.json()) as Body;
    assert.equal(out.code, 'ARTICLE_INVALID');
    assert.equal(out.field, field, JSON.stringify(body));
  }
  assert.equal(updates.length, 0);
});

test('PATCH: changing the slug to one another article uses is 409 ARTICLE_SLUG_TAKEN; keeping or freeing its own is fine', async () => {
  articles.push({ _id: oid(303), store: STORE_A, type: 'blog', title: 'Second', slug: 'second', content: '', status: 'draft', publishedAt: null, tags: [], revision: 0, mediaRefs: [], createdAt: T0, updatedAt: T0 });
  const clash = await patch(ART_A, { revision: 0, slug: 'second' });
  assert.equal(clash.status, 409);
  assert.equal(((await clash.json()) as Body).code, 'ARTICLE_SLUG_TAKEN');
  assert.equal(row(ART_A).slug, 'eid-collection');
  assert.equal((await patch(ART_A, { revision: 0, slug: 'eid-collection' })).status, 200, 'its own slug again');
  assert.equal((await patch(ART_A, { revision: 1, slug: 'eid-new' })).status, 200);
  assert.equal(row(ART_A).slug, 'eid-new');
  // The unique index is the last word on a race.
  failNextUpdateWithDuplicate = true;
  assert.equal((await patch(ART_A, { revision: 2, slug: 'eid-newer' })).status, 409);
});

test('publish and unpublish: publishedAt is set the first time and kept after, each is audited, and the storefront is purged only when a published article is involved', async () => {
  assert.equal((await patch(ART_A, { revision: 0, content: 'Draft edit' })).status, 200);
  await settleRevalidations();
  assert.equal(purges.length, 0, 'editing a draft purges nothing');

  const published = (await (await patch(ART_A, { revision: 1, status: 'published' })).json()) as Body;
  assert.equal(published.status, 'published');
  const firstDate = published.publishedAt as string;
  assert.ok(typeof firstDate === 'string');
  assert.equal(audits.at(-1)!.action, 'article.publish');
  await settleRevalidations();
  const afterPublish = purges.length;
  assert.ok(afterPublish >= 1, 'publishing purges');

  const unpublished = (await (await patch(ART_A, { revision: 2, status: 'draft' })).json()) as Body;
  assert.equal(unpublished.status, 'draft');
  assert.equal(unpublished.publishedAt, firstDate, 'the first publish date is kept');
  assert.equal(audits.at(-1)!.action, 'article.unpublish');
  await settleRevalidations();
  assert.ok(purges.length > afterPublish, 'unpublishing purges (the page must go away)');

  const again = (await (await patch(ART_A, { revision: 3, status: 'published' })).json()) as Body;
  assert.equal(again.publishedAt, firstDate, 'publishing again does not move the date');

  // Editing the text of a published article purges too, and the status does not need to change for it.
  const before = purges.length;
  await patch(ART_A, { revision: 4, content: 'Fixed typo' });
  await settleRevalidations();
  assert.ok(purges.length > before);
});

test('PATCH: the cover and the pictures are checked again, and recorded again; leaving them out keeps them', async () => {
  assert.equal((await patch(ART_A, { revision: 0, coverImage: MEDIA_A, content: '![x](' + URL_A2 + ')' })).status, 200);
  assert.deepEqual([...row(ART_A).mediaRefs].sort(), [MEDIA_A, MEDIA_A2].sort());
  assert.equal((await patch(ART_A, { revision: 1, title: 'Only the title' })).status, 200);
  assert.deepEqual([...row(ART_A).mediaRefs].sort(), [MEDIA_A, MEDIA_A2].sort(), 'untouched');
  assert.equal(String(row(ART_A).coverImage), MEDIA_A);
  assert.equal((await patch(ART_A, { revision: 2, coverImage: null })).status, 200);
  assert.equal(row(ART_A).coverImage, null);
  assert.deepEqual(row(ART_A).mediaRefs, [MEDIA_A2], 'the removed cover is no longer referenced');
  const foreign = await patch(ART_A, { revision: 3, coverImage: MEDIA_B });
  assert.equal(foreign.status, 400);
  assert.equal(((await foreign.json()) as Body).field, 'coverImage');
  const stranger = await patch(ART_A, { revision: 3, content: '![x](https://evil.test/x.png)' });
  assert.equal(((await stranger.json()) as Body).field, 'content');
  assert.equal(row(ART_A).revision, 3, 'the refused saves wrote nothing');
});

// -------------------------------------------------------------------------------------------------------------------------------- isolation

test('Seller B cannot write Seller A\'s article: A\'s store id is 403, A\'s article under B\'s own store is 404, and nothing changes', async () => {
  const asA = { token: tokenB, store: STORE_A };
  const underB = { token: tokenB, store: STORE_B };
  assert.equal((await patch(ART_A, { revision: 0, title: 'Hijacked' }, asA)).status, 403);
  assert.equal((await patch(ART_A, { revision: 0, title: 'Hijacked' }, underB)).status, 404);
  assert.equal((await remove(ART_A, asA)).status, 403);
  assert.equal((await remove(ART_A, underB)).status, 404);
  assert.equal((await read(ART_A, asA)).status, 403);
  const peek = await read(ART_A, underB);
  assert.equal(peek.status, 404);
  assert.equal((await peek.text()).includes('Eid collection'), false);
  assert.equal(updates.length, 0, 'no write was attempted');
  assert.equal(row(ART_A).title, 'Eid collection');
  assert.equal(articles.length, 2);
  assert.equal(audits.length, 0);
  // And B's own article is B's alone.
  assert.equal((await patch(ART_B, { revision: 0, title: 'Mine now' }, { token: tokenA, store: STORE_A })).status, 404);
  assert.equal((await patch(ART_B, { revision: 0, title: 'Mine now' }, underB)).status, 200);
});

test('PATCH and DELETE: no session is 401, an admin is 403, a bad id is 404', async () => {
  assert.equal((await patch(ART_A, { revision: 0, title: 'Anyone' }, { token: null })).status, 401);
  assert.equal((await patch(ART_A, { revision: 0, title: 'Admin edit' }, { token: tokenAdmin })).status, 403);
  assert.equal((await remove(ART_A, { token: null })).status, 401);
  assert.equal((await remove(ART_A, { token: tokenAdmin })).status, 403);
  assert.equal((await patch('not-an-id', { revision: 0, title: 'Nothing here' })).status, 404);
  assert.equal((await remove('not-an-id')).status, 404);
  assert.equal((await patch(oid(999), { revision: 0, title: 'Nothing here' })).status, 404);
  assert.equal(updates.length, 0);
  assert.equal(articles.length, 2);
});

test('the list and the detail show the store\'s own articles only', async () => {
  const mine = (await (await list()).json()) as { docs: Body[]; totalDocs: number };
  assert.deepEqual(mine.docs.map((d) => d.id), [ART_A]);
  const theirs = (await (await list('', { token: tokenB, store: STORE_B })).json()) as { docs: Body[] };
  assert.deepEqual(theirs.docs.map((d) => d.id), [ART_B]);
  assert.equal((await list('', { token: tokenB, store: STORE_A })).status, 403);
});

// ---------------------------------------------------------------------------------------------------------------------------------- delete

test('DELETE removes the article, audits it, purges only when it was published, and a second delete is 404', async () => {
  const draft = await remove(ART_A);
  assert.equal(draft.status, 200);
  assert.deepEqual(await draft.json(), { deleted: true, id: ART_A });
  assert.equal(articles.some((r) => r._id === ART_A), false);
  assert.equal(audits.at(-1)!.action, 'article.delete');
  await settleRevalidations();
  assert.equal(purges.length, 0, 'a draft was never shown');
  assert.equal((await remove(ART_A)).status, 404);

  articles.push({ _id: oid(310), store: STORE_A, type: 'blog', title: 'Live one', slug: 'live', content: '', status: 'published', publishedAt: T0, tags: [], revision: 0, mediaRefs: [], createdAt: T0, updatedAt: T0 });
  assert.equal((await remove(oid(310))).status, 200);
  await settleRevalidations();
  assert.ok(purges.length >= 1, 'a published article leaves the storefront');
});

// ---------------------------------------------------------------------------------------------------------------------------- list and read

test('the list filters by status and by title, never holds the text, and treats the search as text, not as a pattern', async () => {
  articles.push(
    { _id: oid(320), store: STORE_A, type: 'blog', title: 'Winter (sale) guide', slug: 'winter', content: 'secret body', status: 'published', publishedAt: T0, tags: [], revision: 2, mediaRefs: [MEDIA_A], createdAt: new Date(T0.getTime() + 5000), updatedAt: T0 },
    { _id: oid(321), store: STORE_A, type: 'blog', title: 'Spring', slug: 'spring', content: '', status: 'draft', publishedAt: null, createdAt: T0, updatedAt: T0 },
  );
  const all = (await (await list()).json()) as { docs: Body[]; totalDocs: number };
  assert.equal(all.totalDocs, 3);
  assert.ok(all.docs.every((d) => !('content' in d) && !('mediaRefs' in d)), 'no text and no references in the list');
  const publishedOnly = (await (await list('?status=published')).json()) as { docs: Body[] };
  assert.deepEqual(publishedOnly.docs.map((d) => d.slug), ['winter']);
  const draftsOnly = (await (await list('?status=draft')).json()) as { docs: Body[] };
  assert.equal(draftsOnly.docs.length, 2);
  const search = (await (await list('?q=WINTER')).json()) as { docs: Body[] };
  assert.deepEqual(search.docs.map((d) => d.slug), ['winter']);
  const paren = (await (await list('?q=' + encodeURIComponent('(sale)'))).json()) as { docs: Body[] };
  assert.deepEqual(paren.docs.map((d) => d.slug), ['winter'], 'a parenthesis is a letter, not a group');
  const wildcard = (await (await list('?q=' + encodeURIComponent('.*'))).json()) as { docs: Body[] };
  assert.equal(wildcard.docs.length, 0, 'a pattern matches nothing');
  const legacy = (await (await list()).json()) as { docs: Body[] };
  assert.equal(legacy.docs.find((d) => d.slug === 'spring')!.revision, 0);
  assert.equal((await list('?status=nope')).status, 422);
});

test('the detail reads older rich-text content as plain paragraphs and always carries a revision and tags', async () => {
  articles.push({
    _id: oid(330),
    store: STORE_A,
    type: 'blog',
    title: 'Old one',
    slug: 'old-one',
    status: 'draft',
    content: { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'First' }] }, { type: 'paragraph', children: [{ type: 'text', text: 'Second' }] }] } },
    createdAt: T0,
    updatedAt: T0,
  });
  const body = (await (await read(oid(330))).json()) as Body;
  assert.equal(body.content, 'First\n\nSecond');
  assert.equal(body.revision, 0);
  assert.deepEqual(body.tags, []);
  assert.equal(articleContentText(null), '');
  assert.equal(articleContentText('plain'), 'plain');
  assert.equal('mediaRefs' in articleToWire({ _id: 'x', mediaRefs: [MEDIA_A] }), false);
});

test('the detail carries the address of the cover (a file of this store only)', async () => {
  articles.push({ _id: oid(331), store: STORE_A, type: 'blog', title: 'With cover', slug: 'with-cover', status: 'draft', content: '', coverImage: MEDIA_A, createdAt: T0, updatedAt: T0 });
  const body = (await (await read(oid(331))).json()) as Body;
  assert.equal(body.coverImageUrl, URL_A);
  articles.push({ _id: oid(332), store: STORE_A, type: 'blog', title: 'Foreign cover', slug: 'foreign-cover', status: 'draft', content: '', coverImage: MEDIA_B, createdAt: T0, updatedAt: T0 });
  assert.equal(((await (await read(oid(332))).json()) as Body).coverImageUrl, null, 'a file of another store is never shown');
  assert.equal(((await (await read(ART_A)).json()) as Body).coverImageUrl, undefined, 'no cover, no address');
});

// ------------------------------------------------------------------------------------------------------------------ the media registry

test('an image an article uses can never be deleted: the registry lists the article, DELETE of the file is 409, and the file is free again once the article is gone', async () => {
  assert.equal((await create({ title: 'Uses a picture', coverImage: MEDIA_A, content: '![x](' + URL_A2 + ')' })).status, 201);
  const cover = await findMediaUsage(STORE_A, MEDIA_A);
  assert.equal(cover.inUse, true);
  assert.deepEqual(cover.features.map((f) => [f.key, f.label, f.count]), [['articles', 'Blog articles', 1]]);
  assert.equal(cover.features[0]!.items[0]!.title, 'Uses a picture');
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A2)).inUse, true, 'an image inside the text counts too');
  assert.equal((await findMediaUsage(STORE_A, oid(999))).inUse, false);

  const refused = await mediaItem.DELETE(
    new NextRequest('http://seller.test/api/media/' + MEDIA_A, { method: 'DELETE', headers: { authorization: 'Bearer ' + tokenA, 'x-store-id': STORE_A } }),
    params(MEDIA_A),
  );
  assert.equal(refused.status, 409);
  const body = (await refused.json()) as Body;
  assert.equal(body.code, 'MEDIA_IN_USE');
  assert.equal(body.features[0].key, 'articles');

  articles = articles.filter((r) => r.slug !== 'uses-a-picture');
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A)).inUse, false);
});

test('another store\'s article never makes this store\'s file look used', async () => {
  articles.push({ _id: oid(340), store: STORE_B, type: 'blog', title: 'B uses an id', slug: 'b-uses', content: '', status: 'draft', mediaRefs: [MEDIA_A], createdAt: T0, updatedAt: T0 });
  assert.equal((await findMediaUsage(STORE_A, MEDIA_A)).inUse, false);
});

// ------------------------------------------------------------------------------------------------------------ the shopper's view (S7-B3 builds the route on this)

test('a draft or archived article never reaches the shopper: the filter says published blog only, and the DTO answers null for anything else', () => {
  assert.deepEqual(publicArticleFilter(STORE_A), { store: STORE_A, status: 'published', type: 'blog' });
  const base = { _id: ART_A, title: 'Title', slug: 'title', content: 'text', type: 'blog' };
  assert.equal(toStorefrontArticle({ ...base, status: 'draft' }), null);
  assert.equal(toStorefrontArticle({ ...base, status: 'archived' }), null);
  assert.equal(toStorefrontArticle({ ...base, status: undefined }), null);
  assert.equal(toStorefrontArticle({ ...base, status: 'Published' }), null, 'only the exact status');
  assert.equal(toStorefrontArticle({ ...base, status: 'published', type: 'lookbook' }), null);
  assert.equal(toStorefrontArticle({ ...base, status: 'published', title: '' }), null);
  assert.ok(toStorefrontArticle({ ...base, status: 'published' }) !== null);
});

test('the shopper\'s view carries the safe tree and nothing private', () => {
  const dto = toStorefrontArticle(
    {
      _id: ART_A,
      store: STORE_A,
      type: 'blog',
      status: 'published',
      revision: 7,
      mediaRefs: [MEDIA_A],
      title: 'Eid',
      slug: 'eid',
      excerpt: 'Short',
      content: '# Hi\n\n<script>alert(1)</script> [bad](javascript:alert(1)) [ok](https://example.com)',
      tags: ['a', 3, 'b'],
      seoTitle: 'Eid SEO',
      publishedAt: T0,
    } as any,
    { coverImageUrl: 'https://cdn.test/a.png' },
  )!;
  assert.deepEqual(Object.keys(dto).sort(), ['content', 'coverImageUrl', 'excerpt', 'id', 'publishedAt', 'seoDescription', 'seoTitle', 'slug', 'tags', 'title']);
  assert.deepEqual(dto.tags, ['a', 'b']);
  assert.equal(dto.publishedAt, T0.toISOString());
  assert.equal(dto.coverImageUrl, 'https://cdn.test/a.png');
  const json = JSON.stringify(dto.content);
  assert.ok(!json.includes('javascript:'), 'a bad link is gone');
  assert.ok(json.includes('https://example.com/'), 'a good link stays');
  assert.ok(json.includes('<script>alert(1)</script>'), 'markup is only text in the tree (it is escaped on output)');
  assert.equal(toStorefrontArticle({ _id: ART_A, type: 'blog', status: 'published', title: 'T', slug: 't', content: '' }, { coverImageUrl: 'http://insecure.test/a.png' })!.coverImageUrl, null);
});
