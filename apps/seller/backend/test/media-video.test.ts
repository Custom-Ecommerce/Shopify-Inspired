import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { Media, Store, signSession } from '@/lib/services';

const AUTH_SECRET = 'x'.repeat(40);
const SELLER_A = '65a000000000000000000001';
const SELLER_B = '65a000000000000000000002';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';

const VIDEO_URL = 'https://res.cloudinary.com/demo/video/upload/v1/markaz/clip.mp4';

interface StoreRow {
  _id: string;
  owner: string;
}

interface StubQuery {
  select: () => StubQuery;
  sort: () => StubQuery;
  lean: () => Promise<StoreRow | null>;
}

interface CloudinaryCall {
  url: string;
  form: FormData;
}

const STORES: StoreRow[] = [
  { _id: STORE_A, owner: SELLER_A },
  { _id: STORE_B, owner: SELLER_B },
];

const mongooseStub = mongoose as unknown as { connect: () => Promise<unknown> };
const StoreStub = Store as unknown as {
  findOne: (filter: { owner: unknown }) => StubQuery;
  exists: (filter: { _id: string; owner: unknown }) => Promise<{ _id: string } | null>;
};
const MediaStub = Media as unknown as { create: (doc: Record<string, unknown>) => Promise<Record<string, unknown>> };

function oneQuery(row: StoreRow | null): StubQuery {
  const query: StubQuery = { select: () => query, sort: () => query, lean: async () => row };
  return query;
}

let POST: (request: NextRequest) => Promise<Response>;
let token: string;
let calls: CloudinaryCall[];
let created: Array<Record<string, unknown>>;
let uploadAnswer: Record<string, unknown>;
let createFails: boolean;
let restore: () => void;

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: SELLER_A, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  POST = (await import('../src/app/api/media/route')).POST;
});

beforeEach(() => {
  calls = [];
  created = [];
  createFails = false;
  uploadAnswer = { secure_url: VIDEO_URL, public_id: 'markaz/clip', resource_type: 'video', format: 'mp4', duration: 42.5, bytes: 1000, width: 640, height: 360 };

  const saved = {
    connect: mongooseStub.connect,
    findOne: StoreStub.findOne,
    exists: StoreStub.exists,
    create: MediaStub.create,
    fetch: globalThis.fetch,
    env: { name: process.env.CLOUDINARY_CLOUD_NAME, key: process.env.CLOUDINARY_API_KEY, secret: process.env.CLOUDINARY_API_SECRET },
  };
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  mongooseStub.connect = async () => mongoose;
  StoreStub.findOne = (filter) => oneQuery(STORES.find((row) => row.owner === String(filter.owner)) ?? null);
  StoreStub.exists = async (filter) => {
    const row = STORES.find((candidate) => candidate._id === filter._id && candidate.owner === String(filter.owner));
    return row ? { _id: row._id } : null;
  };
  MediaStub.create = async (doc) => {
    if (createFails) throw new Error('database down');
    const row = { _id: '65a0000000000000000000f1', ...doc };
    created.push(row);
    return row;
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, form: init?.body as FormData });
    const body = url.endsWith('/destroy') ? { result: 'ok' } : url.includes('/image/upload') ? imageAnswer : uploadAnswer;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  restore = () => {
    mongooseStub.connect = saved.connect;
    StoreStub.findOne = saved.findOne;
    StoreStub.exists = saved.exists;
    MediaStub.create = saved.create;
    globalThis.fetch = saved.fetch;
    process.env.CLOUDINARY_CLOUD_NAME = saved.env.name;
    process.env.CLOUDINARY_API_KEY = saved.env.key;
    process.env.CLOUDINARY_API_SECRET = saved.env.secret;
  };
});

afterEach(() => restore());

const imageAnswer = { secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/a.png', public_id: 'markaz/a', resource_type: 'image', width: 10, height: 10, bytes: 3 };

function upload(file: Blob, storeId: string = STORE_A): Promise<Response> {
  const form = new FormData();
  form.append('file', file, 'upload');
  form.append('alt', 'A clip');
  return POST(new NextRequest('http://seller.test/api/media', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-store-id': storeId }, body: form }));
}

const video = (type = 'video/mp4'): Blob => new Blob([new Uint8Array([1, 2, 3])], { type });

async function errorOf(res: Response): Promise<{ code?: string; message: string }> {
  const body = (await res.json()) as { errors: Array<{ code?: string; message: string }> };
  const first = body.errors[0];
  assert.ok(first);
  return first;
}

const destroyed = (): CloudinaryCall[] => calls.filter((call) => call.url.endsWith('/video/destroy'));

test('a video is stored with what Cloudinary measured, in the owned store', async () => {
  const res = await upload(video());
  assert.equal(res.status, 201);
  assert.ok(calls[0]?.url.includes('/video/upload'));
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.resourceType, 'video');
  assert.equal(body.duration, 42.5);
  assert.equal(body.format, 'mp4');
  assert.equal(body.bytes, 1000);
  assert.equal(body.url, VIDEO_URL);
  assert.equal(body.posterUrl, 'https://res.cloudinary.com/demo/video/upload/v1/markaz/clip.jpg');
  assert.equal(body.store, STORE_A);
  assert.equal(destroyed().length, 0);
});

test('over 60 seconds is refused, nothing is recorded, and the asset is deleted with a signed call', async () => {
  uploadAnswer = { ...uploadAnswer, duration: 60.5 };
  const res = await upload(video());
  assert.equal(res.status, 422);
  assert.equal((await errorOf(res)).code, 'MEDIA_VIDEO_TOO_LONG');
  assert.equal(created.length, 0);

  const [call] = destroyed();
  assert.ok(call);
  assert.equal(call.form.get('public_id'), 'markaz/clip');
  assert.equal(String(call.form.get('signature')).length, 40);
});

test('exactly 60 seconds is allowed', async () => {
  uploadAnswer = { ...uploadAnswer, duration: 60 };
  assert.equal((await upload(video())).status, 201);
});

test('a duration sent by the client means nothing: without Cloudinary\'s the file is refused and deleted', async () => {
  const { duration: _duration, ...withoutDuration } = uploadAnswer;
  uploadAnswer = withoutDuration;
  const form = new FormData();
  form.append('file', video(), 'upload');
  form.append('alt', 'A clip');
  form.append('duration', '5');
  const res = await POST(new NextRequest('http://seller.test/api/media', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form }));
  assert.equal(res.status, 422);
  assert.equal((await errorOf(res)).code, 'MEDIA_VIDEO_UNREADABLE');
  assert.equal(destroyed().length, 1);
});

test('a format the browser label hid is refused from Cloudinary\'s answer, and deleted', async () => {
  uploadAnswer = { ...uploadAnswer, format: 'avi' };
  const res = await upload(video());
  assert.equal(res.status, 415);
  assert.equal(destroyed().length, 1);
  assert.equal(created.length, 0);
});

test('a video that cannot be recorded does not stay in Cloudinary', async () => {
  createFails = true;
  const logged = console.error;
  console.error = () => undefined;
  try {
    assert.equal((await upload(video())).status, 500);
  } finally {
    console.error = logged;
  }
  assert.equal(destroyed().length, 1);
});

test('a type outside the list and a file over 50 MB are refused before anything is uploaded', async () => {
  const wrong = await upload(video('video/x-msvideo'));
  assert.equal(wrong.status, 415);
  assert.equal((await errorOf(wrong)).code, 'MEDIA_VIDEO_FORMAT');

  const big = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], { type: 'video/mp4' });
  const large = await upload(big);
  assert.equal(large.status, 413);
  assert.equal((await errorOf(large)).code, 'MEDIA_VIDEO_TOO_LARGE');
  assert.equal(calls.length, 0);
});

test('webm and mov are accepted', async () => {
  assert.equal((await upload(video('video/webm'))).status, 201);
  uploadAnswer = { ...uploadAnswer, format: 'mov' };
  assert.equal((await upload(video('video/quicktime'))).status, 201);
});

test('another seller\'s store is refused before anything is uploaded', async () => {
  assert.equal((await upload(video(), STORE_B)).status, 403);
  assert.equal(calls.length, 0);
});

test('images are unaffected: same endpoint, same limits, nothing about videos on the record', async () => {
  const res = await upload(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  assert.equal(res.status, 201);
  assert.ok(calls[0]?.url.includes('/image/upload'));
  assert.equal('duration' in (created[0] ?? {}), false);

  assert.equal((await upload(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }))).status, 413);
  assert.equal((await upload(new Blob([new Uint8Array([1])], { type: 'text/plain' }))).status, 415);
});
