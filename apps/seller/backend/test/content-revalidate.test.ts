import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as tagsNs from '@markaz/platform-kit/cache-tags';
import { AuditLog, Media, Store, StoreArticle, StorePage, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { unwrapCjs } from '@/lib/cjs';
import { revalidateStore, settleRevalidations } from '../src/lib/revalidate';

// Sprint 7 (S7-B3): the storefront reads the blog and the pages under the store's `static` tag, and every article or page change that a shopper can see
// purges it. This test reads the REAL request the backend sends (its body is the tag list), for the store call itself and for each write route.

const { storeTags, isAllowedRevalidateTag } = unwrapCjs(tagsNs) as typeof tagsNs;

const SECRET = 'x'.repeat(40);
const oid = (n: number): string => n.toString(16).padStart(24, '0');
const USER = oid(1);
const STORE = oid(11);
const ART = oid(301);
const PAGE = oid(401);
const ArticleModel = StoreArticle as any;
const PageModel = StorePage as any;
const MediaModel = Media as any;
const StoreModel = Store as any;
const AuditModel = AuditLog as any;

let articles: Array<Record<string, any>> = [];
let pages: Array<Record<string, any>> = [];
let bodies: string[] = [];
let token = '';
let restore: () => void = () => {};
let articleRoute: { PATCH: (r: NextRequest, c: any) => Promise<Response>; DELETE: (r: NextRequest, c: any) => Promise<Response> };
let pageRoute: { PATCH: (r: NextRequest, c: any) => Promise<Response>; DELETE: (r: NextRequest, c: any) => Promise<Response> };

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: USER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  articleRoute = (await import('../src/app/api/storeArticles/[id]/route')) as any;
  pageRoute = (await import('../src/app/api/storePages/[id]/route')) as any;
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};
const matches = (row: Record<string, any>, filter: Record<string, any>): boolean => Object.entries(filter).every(([k, v]) => String(row[k]) === String(v));
const T0 = new Date('2026-11-01T10:00:00Z');

beforeEach(() => {
  articles = [{ _id: ART, store: STORE, type: 'blog', title: 'Post', slug: 'post', content: '', status: 'draft', publishedAt: null, revision: 0, mediaRefs: [], tags: [], createdAt: T0, updatedAt: T0 }];
  pages = [{ _id: PAGE, store: STORE, title: 'About us', slug: 'about', body: '', status: 'draft', showInFooter: true, sortOrder: 0, revision: 0, mediaRefs: [], publishedAt: null, createdAt: T0, updatedAt: T0 }];
  bodies = [];
  process.env.STOREFRONT_URL = 'https://markazify.com';
  process.env.REVALIDATE_SECRET = 'r'.repeat(40);
  const saved = {
    connect: (mongoose as any).connect,
    fetch: globalThis.fetch,
    article: Object.fromEntries(['findOne', 'updateOne', 'deleteOne'].map((m) => [m, ArticleModel[m]])),
    page: Object.fromEntries(['findOne', 'updateOne', 'deleteOne'].map((m) => [m, PageModel[m]])),
    media: MediaModel.find,
    store: Object.fromEntries(['findOne', 'findById', 'exists'].map((m) => [m, StoreModel[m]])),
    audit: AuditModel.create,
  };
  (mongoose as any).connect = async () => mongoose;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const rowsOf = (rows: Array<Record<string, any>>) => (filter: any) => chain(() => structuredClone(rows.find((r) => matches(r, filter)) ?? null));
  ArticleModel.findOne = (filter: any) => rowsOf(articles)(filter);
  PageModel.findOne = (filter: any) => rowsOf(pages)(filter);
  const update = (rows: Array<Record<string, any>>) => async (filter: any, upd: any) => {
    const row = rows.find((r) => String(r._id) === String(filter._id));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, upd.$set ?? {});
    row.revision += 1;
    return { matchedCount: 1 };
  };
  ArticleModel.updateOne = update(articles);
  PageModel.updateOne = update(pages);
  const del = (rows: Array<Record<string, any>>) => async (filter: any) => {
    const i = rows.findIndex((r) => String(r._id) === String(filter._id));
    if (i === -1) return { deletedCount: 0 };
    rows.splice(i, 1);
    return { deletedCount: 1 };
  };
  ArticleModel.deleteOne = del(articles);
  PageModel.deleteOne = del(pages);
  MediaModel.find = () => chain(() => []);
  StoreModel.findOne = (filter: any) => chain(() => (String(filter._id) === STORE ? { _id: STORE, owner: USER, slug: 'zara', internalHandle: 'zara-1' } : null));
  StoreModel.findById = () => chain(() => ({ slug: 'zara', internalHandle: 'zara-1' }));
  StoreModel.exists = async (filter: any) => (String(filter._id) === STORE && String(filter.owner) === USER ? { _id: STORE } : null);
  AuditModel.create = async () => ({ _id: new mongoose.Types.ObjectId() });
  restore = () => {
    (mongoose as any).connect = saved.connect;
    globalThis.fetch = saved.fetch;
    for (const [m, fn] of Object.entries(saved.article)) ArticleModel[m] = fn;
    for (const [m, fn] of Object.entries(saved.page)) PageModel[m] = fn;
    MediaModel.find = saved.media;
    for (const [m, fn] of Object.entries(saved.store)) StoreModel[m] = fn;
    AuditModel.create = saved.audit;
    delete process.env.STOREFRONT_URL;
    delete process.env.REVALIDATE_SECRET;
  };
});

afterEach(() => restore());

const req = (method: string, body?: unknown) =>
  new NextRequest('http://seller.test/api/x/1', { method, headers: { authorization: 'Bearer ' + token, 'x-store-id': STORE, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tagsSent = (): string[] => bodies.flatMap((b) => (JSON.parse(b) as { tags: string[] }).tags);

test('the store purge carries the static tag the storefront reads the blog and the pages under, and every tag it sends is one the storefront accepts', async () => {
  revalidateStore(STORE);
  await settleRevalidations();
  const tags = tagsSent();
  assert.ok(tags.includes(storeTags.static(STORE)), 'the static tag is dropped');
  assert.equal(storeTags.static(STORE), 'store:' + STORE + ':static');
  for (const tag of tags) assert.equal(isAllowedRevalidateTag(tag), true, tag);
});

test('publishing, editing and unpublishing an article each purge the static tag; editing a draft purges nothing', async () => {
  assert.equal((await articleRoute.PATCH(req('PATCH', { revision: 0, title: 'Draft edit' }), ctx(ART))).status, 200);
  await settleRevalidations();
  assert.equal(bodies.length, 0, 'a draft edit is invisible to shoppers');

  assert.equal((await articleRoute.PATCH(req('PATCH', { revision: 1, status: 'published' }), ctx(ART))).status, 200);
  await settleRevalidations();
  assert.ok(tagsSent().includes(storeTags.static(STORE)), 'publish');

  bodies = [];
  assert.equal((await articleRoute.PATCH(req('PATCH', { revision: 2, title: 'Published edit' }), ctx(ART))).status, 200);
  await settleRevalidations();
  assert.ok(tagsSent().includes(storeTags.static(STORE)), 'edit of a published article');

  bodies = [];
  assert.equal((await articleRoute.PATCH(req('PATCH', { revision: 3, status: 'draft' }), ctx(ART))).status, 200);
  await settleRevalidations();
  assert.ok(tagsSent().includes(storeTags.static(STORE)), 'unpublish');
});

test('deleting a published article purges the static tag; deleting a draft does not', async () => {
  articles.push({ _id: oid(302), store: STORE, type: 'blog', title: 'Live', slug: 'live', content: '', status: 'published', revision: 0, mediaRefs: [], createdAt: T0, updatedAt: T0 });
  assert.equal((await articleRoute.DELETE(req('DELETE'), ctx(ART))).status, 200);
  await settleRevalidations();
  assert.equal(bodies.length, 0, 'a draft was never shown');
  assert.equal((await articleRoute.DELETE(req('DELETE'), ctx(oid(302)))).status, 200);
  await settleRevalidations();
  assert.ok(tagsSent().includes(storeTags.static(STORE)));
});

test('publishing, unpublishing and deleting a page purge the static tag too', async () => {
  assert.equal((await pageRoute.PATCH(req('PATCH', { revision: 0, status: 'published' }), ctx(PAGE))).status, 200);
  await settleRevalidations();
  assert.ok(tagsSent().includes(storeTags.static(STORE)), 'publish');
  bodies = [];
  assert.equal((await pageRoute.PATCH(req('PATCH', { revision: 1, status: 'draft' }), ctx(PAGE))).status, 200);
  await settleRevalidations();
  assert.ok(tagsSent().includes(storeTags.static(STORE)), 'unpublish');
  bodies = [];
  pages[0]!.status = 'published';
  assert.equal((await pageRoute.DELETE(req('DELETE'), ctx(PAGE))).status, 200);
  await settleRevalidations();
  assert.ok(tagsSent().includes(storeTags.static(STORE)), 'delete');
});
