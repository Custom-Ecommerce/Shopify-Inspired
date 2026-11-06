import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { assertCan, signSession, Store, User, Category, Media } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { signParams } from '@/lib/cloudinary';

const SECRET = 'x'.repeat(40);
const USER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const OTHER_STORE = '65a000000000000000000012';
const MEDIA1 = '65a0000000000000000000f1';
const MEDIA_OTHER = '65a0000000000000000000f2';
const CAT_A = '65a0000000000000000000c1';
const CAT_B = '65a0000000000000000000c2';
const CAT_OTHER = '65a0000000000000000000c3';

const CategoryModel = Category as any;
const MediaModel = Media as any;
const UserModel = User as any;
const StoreModel = Store as unknown as { findOne: () => unknown };

let categories: Array<Record<string, any>> = [];
let media: Array<Record<string, any>> = [];
let nextId = 300;
let token = '';

let categoriesGET: (request: NextRequest) => Promise<Response>;
let mediaGET: (request: NextRequest) => Promise<Response>;
let mediaPOST: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = 'k';
  process.env.CLOUDINARY_API_SECRET = 's';
  token = await signSession({ sub: USER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  categoriesGET = (await import('../src/app/api/categories/route')).GET;
  mediaGET = (await import('../src/app/api/media/route')).GET;
  mediaPOST = (await import('../src/app/api/media/route')).POST;
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
    cFind: CategoryModel.find,
    cCount: CategoryModel.countDocuments,
    mFind: MediaModel.find,
    mCount: MediaModel.countDocuments,
    mCreate: MediaModel.create,
    uFindById: UserModel.findById,
    sFindOne: StoreModel.findOne,
  };
  (mongoose as any).connect = async () => mongoose;
  CategoryModel.find = (filter: any) => query(categories.filter((r) => matches(r, filter)));
  CategoryModel.countDocuments = async (filter: any) => categories.filter((r) => matches(r, filter)).length;
  MediaModel.find = (filter: any) => query(media.filter((r) => matches(r, filter)));
  MediaModel.countDocuments = async (filter: any) => media.filter((r) => matches(r, filter)).length;
  MediaModel.create = async (doc: any) => {
    const row = { _id: String(nextId++), ...doc, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
    media.push(row);
    return row;
  };
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ store: STORE }) }) });
  StoreModel.findOne = () => query([{ _id: STORE }], true);
  return () => {
    (mongoose as any).connect = originals.connect;
    CategoryModel.find = originals.cFind;
    CategoryModel.countDocuments = originals.cCount;
    MediaModel.find = originals.mFind;
    MediaModel.countDocuments = originals.mCount;
    MediaModel.create = originals.mCreate;
    UserModel.findById = originals.uFindById;
    StoreModel.findOne = originals.sFindOne;
  };
}

function seed() {
  const now = '2026-10-01T00:00:00.000Z';
  categories = [
    { _id: CAT_A, store: STORE, name: 'Tops', slug: 'tops', order: 1, createdAt: now, updatedAt: now },
    { _id: CAT_B, store: STORE, name: 'Bottoms', slug: 'bottoms', order: 2, createdAt: now, updatedAt: now },
    { _id: CAT_OTHER, store: OTHER_STORE, name: 'Hats', slug: 'hats', order: 0, createdAt: now, updatedAt: now },
  ];
  media = [
    { _id: MEDIA1, store: STORE, alt: 'Shirt front', url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/a.jpg', cloudinaryPublicId: 'markaz/a', cloudinaryResourceType: 'image', createdAt: now, updatedAt: now },
    { _id: MEDIA_OTHER, store: OTHER_STORE, alt: 'Other', url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/b.jpg', cloudinaryPublicId: 'markaz/b', cloudinaryResourceType: 'image', createdAt: now, updatedAt: now },
  ];
}

function authed(method: string, url: string, body?: unknown, bearer = token): NextRequest {
  const headers: Record<string, string> = { authorization: 'Bearer ' + bearer };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function multipart(file: Blob | null, alt: string | null): NextRequest {
  const form = new FormData();
  if (file) form.append('file', file, 'a.png');
  if (alt !== null) form.append('alt', alt);
  return new NextRequest('http://seller.test/api/media', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token },
    body: form,
  });
}

function image(type: string): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type });
}

test('categories require a session: no token is refused with 401', async () => {
  const response = await categoriesGET(new NextRequest('http://seller.test/api/categories'));
  assert.equal(response.status, 401);
});

test('the category list returns only the categories of the seller store, in the list envelope', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await categoriesGET(authed('GET', 'http://seller.test/api/categories'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { docs: Array<Record<string, unknown>>; totalDocs: number };
    assert.equal(body.totalDocs, 2);
    assert.equal(body.docs[0].id, CAT_A);
    assert.equal(body.docs[0].slug, 'tops');
  } finally {
    restore();
  }
});

test('media requires a session: no token is refused with 401', async () => {
  const response = await mediaGET(new NextRequest('http://seller.test/api/media'));
  assert.equal(response.status, 401);
});

test('the media list returns only the seller store records', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await mediaGET(authed('GET', 'http://seller.test/api/media'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { docs: Array<Record<string, unknown>>; totalDocs: number };
    assert.equal(body.totalDocs, 1);
    assert.equal(body.docs[0].id, MEDIA1);
  } finally {
    restore();
  }
});

test('an upload without a file is refused with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await mediaPOST(multipart(null, 'Shirt'));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('an upload without alt text is refused with 422', async () => {
  seed();
  const restore = installStubs();
  try {
    const response = await mediaPOST(multipart(image('image/png'), null));
    assert.equal(response.status, 422);
  } finally {
    restore();
  }
});

test('a non-image upload is refused with 415 before Cloudinary is called', async () => {
  seed();
  const restore = installStubs();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as any;
  try {
    const response = await mediaPOST(multipart(image('text/plain'), 'Notes'));
    assert.equal(response.status, 415);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('an image upload is signed, stored under the seller store, and answered with 201', async () => {
  seed();
  const restore = installStubs();
  const originalFetch = globalThis.fetch;
  let sent: { url: string; body: FormData | null } | null = null;
  globalThis.fetch = (async (url: any, init: any) => {
    sent = { url: String(url), body: init?.body ?? null };
    return new Response(
      JSON.stringify({ secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/new.png', public_id: 'markaz/new', resource_type: 'image', width: 800, height: 600, bytes: 1234 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as any;
  try {
    const response = await mediaPOST(multipart(image('image/png'), 'Shirt back'));
    assert.equal(response.status, 201);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.url, 'https://res.cloudinary.com/demo/image/upload/v1/markaz/new.png');
    assert.equal(body.store, STORE);
    assert.equal(body.alt, 'Shirt back');
    assert.ok(sent !== null);
    assert.ok(String((sent as any).url).includes('/image/upload'));
    const signature = ((sent as any).body as FormData).get('signature');
    assert.equal(typeof signature, 'string');
    assert.equal((signature as string).length, 40);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('the upload signature is SHA-1 over the sorted parameters and the secret', () => {
  const expected = createHash('sha1').update('folder=markaz&timestamp=1700000000' + 'secret').digest('hex');
  assert.equal(signParams({ timestamp: '1700000000', folder: 'markaz' }, 'secret'), expected);
});

test('the policy: sellers manage named category fields only; they may create media with alt only', () => {
  assert.doesNotThrow(() => assertCan('seller', 'read', 'categories'));
  assert.doesNotThrow(() => assertCan('seller', 'create', 'categories', ['name']));
  assert.throws(() => assertCan('seller', 'create', 'categories', ['store']));
  assert.doesNotThrow(() => assertCan('seller', 'create', 'media', ['alt']));
  assert.throws(() => assertCan('seller', 'create', 'media', ['url']));
});
