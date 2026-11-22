import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Media, Store, StoreArticle, StorePage } from '@/lib/services';
import * as markdownNs from '@markaz/platform-kit/content-markdown';
import { unwrapCjs } from '@/lib/cjs';
import { isPublicPage, publicPageFilter, toStorefrontPage, toStorefrontPageLink, toStorefrontArticleSummary } from '../src/lib/storefront/content-dto';
import { isPlainSlug } from '../src/lib/storefront/content-read';

const { markdownToSafeHtml } = unwrapCjs(markdownNs) as typeof markdownNs;

// Sprint 7 (S7-B3): the public blog and page routes of the seller backend. A draft never leaves; the text goes out as the safe tree; isolation between
// stores; the default-copy rule (draft is not "none"). Models are stubbed; no database.

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const STORE_A = oid(11);
const STORE_B = oid(12);
const STORE_PENDING = oid(13);
const MEDIA_A = oid(101);
const MEDIA_B = oid(201);
const T = (day: number): Date => new Date(Date.UTC(2026, 10, day, 10, 0, 0));

const ArticleModel = StoreArticle as any;
const PageModel = StorePage as any;
const MediaModel = Media as any;
const StoreModel = Store as any;

let articles: Array<Record<string, any>> = [];
let pages: Array<Record<string, any>> = [];
let media: Array<Record<string, any>> = [];
let stores: Record<string, Record<string, any>> = {};
let articleReads = 0;
let restore: () => void = () => {};

type Ctx = { params: Promise<Record<string, string>> };
let articleList: (r: NextRequest, c: Ctx) => Promise<Response>;
let articleOne: (r: NextRequest, c: Ctx) => Promise<Response>;
let pageList: (r: NextRequest, c: Ctx) => Promise<Response>;
let pageOne: (r: NextRequest, c: Ctx) => Promise<Response>;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  articleList = (await import('../src/app/api/storefront/v1/stores/[id]/articles/route')).GET as any;
  articleOne = (await import('../src/app/api/storefront/v1/stores/[id]/articles/[slug]/route')).GET as any;
  pageList = (await import('../src/app/api/storefront/v1/stores/[id]/pages/route')).GET as any;
  pageOne = (await import('../src/app/api/storefront/v1/stores/[id]/pages/[slug]/route')).GET as any;
});

const chain = (value: () => unknown, extra: Record<string, (...a: any[]) => any> = {}) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, populate: () => q, lean: async () => value(), ...extra };
  return q;
};

function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && '$in' in cond) return (cond.$in as unknown[]).map(String).includes(String(row[key]));
    return String(row[key]) === String(cond);
  });
}

const article = (over: Record<string, any>): Record<string, any> => ({
  _id: oid(Math.floor(Math.random() * 1e9) + 5000),
  store: STORE_A,
  type: 'blog',
  title: 'Eid collection',
  slug: 'eid-collection',
  excerpt: 'Summer edit',
  content: 'Hello **world**',
  status: 'published',
  coverImage: null,
  tags: ['eid'],
  seoTitle: null,
  seoDescription: null,
  revision: 3,
  mediaRefs: [],
  publishedAt: T(10),
  createdAt: T(9),
  updatedAt: T(10),
  ...over,
});

const page = (over: Record<string, any>): Record<string, any> => ({
  _id: oid(Math.floor(Math.random() * 1e9) + 9000),
  store: STORE_A,
  title: 'About us',
  slug: 'about',
  body: '# About\n\nWe sell lawn.',
  status: 'published',
  showInFooter: true,
  sortOrder: 0,
  revision: 2,
  mediaRefs: [],
  publishedAt: T(1),
  createdAt: T(1),
  updatedAt: T(2),
  ...over,
});

beforeEach(() => {
  articles = [
    article({ _id: oid(301), slug: 'older', title: 'Older post', publishedAt: T(5), createdAt: T(4) }),
    article({ _id: oid(302), slug: 'newest', title: 'Newest post', publishedAt: T(12), createdAt: T(11), coverImage: MEDIA_A, tags: ['eid', 'lawn'] }),
    article({ _id: oid(303), slug: 'secret-draft', title: 'Secret draft', status: 'draft', publishedAt: null, content: 'DRAFT-ONLY-TEXT' }),
    article({ _id: oid(304), slug: 'old-archived', title: 'Archived post', status: 'archived' }),
    article({ _id: oid(305), slug: 'lookbook-one', title: 'A lookbook', type: 'lookbook' }),
    article({ _id: oid(306), store: STORE_B, slug: 'other-store', title: 'Bilal post' }),
    article({ _id: oid(307), slug: 'foreign-cover', title: 'Foreign cover', coverImage: MEDIA_B, publishedAt: T(3) }),
  ];
  pages = [
    page({ _id: oid(401), slug: 'about', title: 'About us', sortOrder: 20 }),
    page({ _id: oid(402), slug: 'shipping', title: 'Shipping', sortOrder: 10 }),
    page({ _id: oid(403), slug: 'contact', title: 'Contact us', status: 'draft', publishedAt: null, body: 'DRAFT-PAGE-TEXT' }),
    page({ _id: oid(404), slug: 'faq', title: 'FAQ', showInFooter: false, sortOrder: 5 }),
    page({ _id: oid(405), store: STORE_B, slug: 'about', title: 'Bilal about', body: 'bilal text' }),
  ];
  media = [
    { _id: MEDIA_A, store: STORE_A, url: 'https://cdn.test/a.png' },
    { _id: MEDIA_B, store: STORE_B, url: 'https://cdn.test/b.png' },
  ];
  stores = {
    [STORE_A]: { _id: STORE_A, status: 'active', storefront: {}, paymentSettings: {} },
    [STORE_B]: { _id: STORE_B, status: 'active', storefront: {}, paymentSettings: {} },
    [STORE_PENDING]: { _id: STORE_PENDING, status: 'pending', storefront: {}, paymentSettings: {} },
  };
  articleReads = 0;
  const saved = {
    connect: (mongoose as any).connect,
    article: Object.fromEntries(['find', 'findOne', 'countDocuments'].map((m) => [m, ArticleModel[m]])),
    page: Object.fromEntries(['find', 'findOne'].map((m) => [m, PageModel[m]])),
    media: Object.fromEntries(['find'].map((m) => [m, MediaModel[m]])),
    store: Object.fromEntries(['findById'].map((m) => [m, StoreModel[m]])),
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findById = (id: unknown) => chain(() => (stores[String(id)] ? structuredClone(stores[String(id)]) : null));
  ArticleModel.find = (filter: any) => {
    articleReads += 1;
    let rows = articles.filter((row) => matches(row, filter)).sort((a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime());
    const q: any = chain(() => structuredClone(rows), {
      skip: (n: number) => ((rows = rows.slice(n)), q),
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
    });
    return q;
  };
  ArticleModel.countDocuments = async (filter: any) => articles.filter((row) => matches(row, filter)).length;
  ArticleModel.findOne = (filter: any) => {
    articleReads += 1;
    return chain(() => structuredClone(articles.find((row) => matches(row, filter)) ?? null));
  };
  PageModel.find = (filter: any) =>
    chain(() => structuredClone(pages.filter((row) => matches(row, filter)).sort((a, b) => a.sortOrder - b.sortOrder || String(a.title).localeCompare(String(b.title)))));
  PageModel.findOne = (filter: any) => chain(() => structuredClone(pages.find((row) => matches(row, filter)) ?? null));
  MediaModel.find = (filter: any) => chain(() => structuredClone(media.filter((row) => matches(row, filter))));
  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [m, fn] of Object.entries(saved.article)) ArticleModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.page)) PageModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.media)) MediaModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
  };
});

afterEach(() => restore());

const req = (path: string) => new NextRequest('http://seller.test/api/storefront/v1/stores/' + path);
const listArticles = (store: string, query = '') => articleList(req(store + '/articles' + query), { params: Promise.resolve({ id: store }) });
const getArticle = (store: string, slug: string) => articleOne(req(store + '/articles/' + slug), { params: Promise.resolve({ id: store, slug }) });
const listPages = (store: string) => pageList(req(store + '/pages'), { params: Promise.resolve({ id: store }) });
const getPage = (store: string, slug: string) => pageOne(req(store + '/pages/' + slug), { params: Promise.resolve({ id: store, slug }) });
type Body = Record<string, any>;

// --------------------------------------------------------------------------------------------------------------------------- article list

test('the blog list holds the PUBLISHED blog articles of the store, newest first, and nothing else', async () => {
  const res = await listArticles(STORE_A);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.deepEqual(body.data.map((a: Body) => a.slug), ['newest', 'older', 'foreign-cover']);
  assert.equal(body.totalDocs, 3);
  assert.equal(body.page, 1);
  assert.equal(body.totalPages, 1);
  const text = JSON.stringify(body);
  for (const leak of ['secret-draft', 'DRAFT-ONLY-TEXT', 'old-archived', 'lookbook-one', 'other-store', 'Bilal post']) assert.equal(text.includes(leak), false, leak);
});

test('a list entry carries only safe fields: no text, status, revision, references or store', async () => {
  const body = (await (await listArticles(STORE_A)).json()) as Body;
  for (const entry of body.data) assert.deepEqual(Object.keys(entry).sort(), ['coverImageUrl', 'excerpt', 'id', 'publishedAt', 'slug', 'tags', 'title']);
  const newest = body.data.find((a: Body) => a.slug === 'newest');
  assert.equal(newest.coverImageUrl, 'https://cdn.test/a.png');
  assert.deepEqual(newest.tags, ['eid', 'lawn']);
  assert.equal(newest.publishedAt, T(12).toISOString());
});

test('a cover that is another store\'s file is never shown', async () => {
  const body = (await (await listArticles(STORE_A)).json()) as Body;
  assert.equal(body.data.find((a: Body) => a.slug === 'foreign-cover').coverImageUrl, null);
  assert.equal(JSON.stringify(body).includes('cdn.test/b.png'), false);
});

test('the list pages: page and limit are honoured and clamped', async () => {
  const first = (await (await listArticles(STORE_A, '?limit=2')).json()) as Body;
  assert.deepEqual(first.data.map((a: Body) => a.slug), ['newest', 'older']);
  assert.equal(first.totalPages, 2);
  const second = (await (await listArticles(STORE_A, '?limit=2&page=2')).json()) as Body;
  assert.deepEqual(second.data.map((a: Body) => a.slug), ['foreign-cover']);
  assert.equal(second.page, 2);
  const clamped = (await (await listArticles(STORE_A, '?limit=9999&page=-4')).json()) as Body;
  assert.equal(clamped.page, 1);
  assert.equal(clamped.data.length, 3);
});

test('the other store has its own blog, and a store with no article has an empty list', async () => {
  const b = (await (await listArticles(STORE_B)).json()) as Body;
  assert.deepEqual(b.data.map((a: Body) => a.slug), ['other-store']);
  articles = articles.filter((a) => a.store !== STORE_B);
  const empty = (await (await listArticles(STORE_B)).json()) as Body;
  assert.deepEqual(empty.data, []);
  assert.equal(empty.totalPages, 1);
});

test('the public answers are cacheable, and an unknown, a malformed or a not-live store is refused', async () => {
  const ok = await listArticles(STORE_A);
  assert.match(ok.headers.get('cache-control') ?? '', /public/);
  assert.equal((await listArticles(oid(999))).status, 404);
  assert.equal((await listArticles('not-an-id')).status, 404);
  const pending = await listArticles(STORE_PENDING);
  assert.equal(pending.status, 403);
  assert.equal(((await pending.json()) as Body).error.code, 'STORE_NOT_ACTIVE');
  assert.equal((await getPage(STORE_PENDING, 'about')).status, 403);
  assert.equal((await listPages(STORE_PENDING)).status, 403);
});

// -------------------------------------------------------------------------------------------------------------------------- article detail

test('a published article is sent with its text as the safe tree, and nothing private', async () => {
  const res = await getArticle(STORE_A, 'newest');
  assert.equal(res.status, 200);
  const { data } = (await res.json()) as Body;
  assert.deepEqual(Object.keys(data).sort(), ['content', 'coverImageUrl', 'excerpt', 'id', 'publishedAt', 'seoDescription', 'seoTitle', 'slug', 'tags', 'title']);
  assert.equal(data.coverImageUrl, 'https://cdn.test/a.png');
  assert.equal(Array.isArray(data.content), true);
  assert.equal(data.content[0].type, 'paragraph');
  assert.equal(typeof data.content, 'object');
  for (const leak of ['status', 'revision', 'mediaRefs', 'store', 'type']) assert.equal(leak in data, false, leak);
});

test('a draft, an archived article, another type, another store\'s article and an unknown slug all answer the same 404', async () => {
  const answers: string[] = [];
  for (const slug of ['secret-draft', 'old-archived', 'lookbook-one', 'other-store', 'no-such-article']) {
    const res = await getArticle(STORE_A, slug);
    assert.equal(res.status, 404, slug);
    const text = await res.text();
    assert.equal(text.includes('DRAFT-ONLY-TEXT'), false, slug);
    assert.equal(text.includes('Secret draft'), false, slug);
    answers.push(text);
  }
  assert.equal(new Set(answers).size, 1, 'a draft is not told apart from an article that does not exist');
  assert.equal(JSON.parse(answers[0]!).error.code, 'ARTICLE_NOT_FOUND');
  assert.equal((await getArticle(STORE_B, 'newest')).status, 404, 'the slug of store A is not found in store B');
});

test('a slug that is not a plain slug is a 404 that never reaches the database', async () => {
  for (const slug of ['..%2Fetc', 'UPPER', 'a b', 'x'.repeat(250), '$ne', '{"$gt":""}']) {
    articleReads = 0;
    assert.equal((await getArticle(STORE_A, slug)).status, 404, slug);
    assert.equal(articleReads, 0, slug);
  }
  assert.equal(isPlainSlug('eid-collection'), true);
  assert.equal(isPlainSlug(''), false);
});

test('markup and bad addresses in an article are text or gone in the tree, and escaped in the HTML a reader may build from it', async () => {
  articles.push(article({ _id: oid(310), slug: 'evil', title: 'Evil', content: '<script>alert(1)</script> <img src=x onerror=alert(2)> [bad](javascript:alert(3)) ![p](http://insecure.test/p.png) [ok](https://example.com)' }));
  const { data } = (await (await getArticle(STORE_A, 'evil')).json()) as Body;
  const json = JSON.stringify(data.content);
  assert.equal(json.includes('javascript:'), false);
  assert.equal(json.includes('insecure.test'), false);
  assert.ok(json.includes('https://example.com/'));
  assert.ok(json.includes('<script>alert(1)</script>'), 'markup stays text in the tree');
  const html = markdownToSafeHtml('<script>alert(1)</script> <img src=x onerror=alert(2)>');
  assert.equal(/<script|<img/.test(html), false);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('an article written before Sprint 7 (rich-text object) is sent as paragraphs', async () => {
  articles.push(article({ _id: oid(311), slug: 'legacy', title: 'Legacy', content: { root: { children: [{ children: [{ text: 'First' }] }, { children: [{ text: 'Second' }] }] } } }));
  const { data } = (await (await getArticle(STORE_A, 'legacy')).json()) as Body;
  assert.deepEqual(data.content.map((b: Body) => b.type), ['paragraph', 'paragraph']);
});

// ------------------------------------------------------------------------------------------------------------------------------- pages

test('the page list holds the PUBLISHED pages of the store in footer order, without text', async () => {
  const body = (await (await listPages(STORE_A)).json()) as Body;
  assert.deepEqual(body.data.map((p: Body) => p.slug), ['faq', 'shipping', 'about'], 'by sort order');
  for (const entry of body.data) assert.deepEqual(Object.keys(entry).sort(), ['showInFooter', 'slug', 'sortOrder', 'title', 'updatedAt']);
  assert.equal(body.data.find((p: Body) => p.slug === 'faq').showInFooter, false);
  const text = JSON.stringify(body);
  for (const leak of ['contact', 'DRAFT-PAGE-TEXT', 'bilal', 'We sell lawn']) assert.equal(text.includes(leak), false, leak);
  const b = (await (await listPages(STORE_B)).json()) as Body;
  assert.deepEqual(b.data.map((p: Body) => p.slug), ['about']);
});

test('a published page is sent as the safe tree', async () => {
  const res = await getPage(STORE_A, 'about');
  assert.equal(res.status, 200);
  const { data } = (await res.json()) as Body;
  assert.deepEqual(Object.keys(data).sort(), ['content', 'publishedAt', 'slug', 'title', 'updatedAt']);
  assert.equal(data.title, 'About us');
  assert.equal(data.content[0].type, 'heading');
  assert.equal(data.content[0].level, 2);
  assert.equal(data.content[1].type, 'paragraph');
  for (const leak of ['status', 'revision', 'mediaRefs', 'store', 'showInFooter', 'body']) assert.equal(leak in data, false, leak);
});

test('a DRAFT page is 404 PAGE_NOT_PUBLISHED (so the storefront never falls back to default copy for it), and its text never leaves', async () => {
  const res = await getPage(STORE_A, 'contact');
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.equal(JSON.parse(text).error.code, 'PAGE_NOT_PUBLISHED');
  assert.equal(text.includes('DRAFT-PAGE-TEXT'), false);
  assert.equal(text.includes('Contact us'), false, 'not even its title');
});

test('a page the store does not have is 404 PAGE_NOT_FOUND (the storefront may show its default copy), and another store\'s page is not this store\'s', async () => {
  const none = await getPage(STORE_A, 'privacy');
  assert.equal(none.status, 404);
  assert.equal(((await none.json()) as Body).error.code, 'PAGE_NOT_FOUND');
  const a = (await (await getPage(STORE_A, 'about')).json()) as Body;
  const b = (await (await getPage(STORE_B, 'about')).json()) as Body;
  assert.equal(a.data.title, 'About us');
  assert.equal(b.data.title, 'Bilal about');
  assert.equal((await getPage(STORE_B, 'shipping')).status, 404, 'store A\'s shipping page does not exist in store B');
  for (const slug of ['..%2Fetc', 'UPPER', 'a b', '$ne']) assert.equal(((await (await getPage(STORE_A, slug)).json()) as Body).error.code, 'PAGE_NOT_FOUND', slug);
});

test('markup in a page body is text or gone in the tree and escaped in HTML', async () => {
  pages.push(page({ _id: oid(410), slug: 'evil', title: 'Evil', body: '<script>alert(1)</script>\n\n[x](javascript:alert(2)) <b onclick=y>bold</b>' }));
  const { data } = (await (await getPage(STORE_A, 'evil')).json()) as Body;
  const json = JSON.stringify(data.content);
  assert.equal(json.includes('javascript:'), false);
  assert.ok(json.includes('<script>alert(1)</script>'));
  assert.equal(/<script|<b /.test(markdownToSafeHtml('<script>alert(1)</script>\n\n<b onclick=y>bold</b>')), false);
});

// ------------------------------------------------------------------------------------------------------------------------ the DTO builders

test('page rules in one place: only published is public, the filter says so, and a null title or slug is not a page', () => {
  assert.deepEqual(publicPageFilter(STORE_A), { store: STORE_A, status: 'published' });
  assert.equal(isPublicPage({ status: 'published' }), true);
  for (const status of ['draft', 'archived', 'Published', undefined, null]) assert.equal(isPublicPage({ status }), false, String(status));
  assert.equal(toStorefrontPage({ _id: 'x', title: 'T', slug: 't', body: 'b', status: 'draft' }), null);
  assert.equal(toStorefrontPage({ _id: 'x', title: '', slug: 't', body: 'b', status: 'published' }), null);
  assert.equal(toStorefrontPageLink({ _id: 'x', title: 'T', slug: 't', status: 'draft' }), null);
  assert.equal(toStorefrontPageLink({ _id: 'x', title: 'T', slug: 't', status: 'published', showInFooter: 'yes' })!.showInFooter, false, 'only a real true shows in the footer');
  assert.equal(toStorefrontArticleSummary({ _id: 'x', title: 'T', slug: 't', status: 'draft', type: 'blog' }), null);
  assert.deepEqual(toStorefrontPage({ _id: 'x', title: 'T', slug: 't', body: undefined, status: 'published' })!.content, []);
});
