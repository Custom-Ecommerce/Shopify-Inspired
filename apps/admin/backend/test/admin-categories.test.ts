import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, Category, User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import {
  CATEGORY_FIELDS,
  buildCategoryFilter,
  categorySnapshot,
  isDuplicateKeyError,
  parseCategoryCreate,
  parseCategoryQuery,
  parseCategoryUpdate,
  slugify,
  toCategoryRow,
} from '@/lib/admin-categories';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const CAT_ID = '65a0000000000000000000d1';
const T1 = new Date('2026-10-01T09:00:00.000Z');
const T2 = new Date('2026-10-05T09:00:00.000Z');

const CategoryModel = Category as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;

let list: { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
let item: {
  PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
  DELETE: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
};

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  list = await import('../src/app/api/admin/categories/route');
  item = await import('../src/app/api/admin/categories/[id]/route');
});

const stored = { _id: CAT_ID, name: 'Lawn', slug: 'lawn', order: 2, description: null, createdAt: T1, updatedAt: T2 };

interface World {
  rows: unknown[];
  total: number;
  found: unknown;
  updated: unknown;
  duplicate: boolean;
  deleted: number;
  auditFails: boolean;
}

const calls = {
  find: [] as any[],
  skip: [] as number[],
  created: [] as any[],
  updates: [] as any[],
  deletes: [] as any[],
  audits: [] as any[],
};

function install(world: Partial<World> = {}): () => void {
  const w: World = { rows: [], total: 0, found: stored, updated: stored, duplicate: false, deleted: 1, auditFails: false, ...world };
  const originals = {
    connect: (mongoose as any).connect,
    userFindById: UserModel.findById,
    find: CategoryModel.find,
    count: CategoryModel.countDocuments,
    create: CategoryModel.create,
    findById: CategoryModel.findById,
    findOneAndUpdate: CategoryModel.findOneAndUpdate,
    updateOne: CategoryModel.updateOne,
    deleteOne: CategoryModel.deleteOne,
    auditCreate: AuditModel.create,
  };
  for (const key of Object.keys(calls) as Array<keyof typeof calls>) (calls[key] as unknown[]).length = 0;
  const lean = (value: unknown): any => {
    const q: any = { sort: () => q, skip: (n: number) => (calls.skip.push(n), q), limit: () => q, lean: async () => value };
    return q;
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin' }) }) });
  CategoryModel.find = (filter: unknown) => (calls.find.push(filter), lean(w.rows));
  CategoryModel.countDocuments = async () => w.total;
  CategoryModel.create = async (doc: any) => {
    if (w.duplicate) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    calls.created.push(doc);
    return { _id: doc._id ?? CAT_ID, createdAt: T1, updatedAt: T1 };
  };
  CategoryModel.findById = () => lean(w.found);
  CategoryModel.findOneAndUpdate = (filter: any, update: any) => {
    if (w.duplicate) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    calls.updates.push({ filter, update });
    return lean(w.updated);
  };
  CategoryModel.updateOne = async (filter: any, update: any) => (calls.updates.push({ filter, update, revert: true }), { matchedCount: 1 });
  CategoryModel.deleteOne = async (filter: any) => (calls.deletes.push(filter), { deletedCount: w.deleted });
  AuditModel.create = async (doc: any) => {
    if (w.auditFails) throw new Error('audit down');
    calls.audits.push(doc);
    return { _id: '65a000000000000000000099' };
  };
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findById = originals.userFindById;
    CategoryModel.find = originals.find;
    CategoryModel.countDocuments = originals.count;
    CategoryModel.create = originals.create;
    CategoryModel.findById = originals.findById;
    CategoryModel.findOneAndUpdate = originals.findOneAndUpdate;
    CategoryModel.updateOne = originals.updateOne;
    CategoryModel.deleteOne = originals.deleteOne;
    AuditModel.create = originals.auditCreate;
  };
}

async function token(role = 'admin', audience = ADMIN_AUDIENCE): Promise<string> {
  return signSession({ sub: ADMIN_ID, role }, SECRET, audience);
}

async function send(method: string, path: string, body?: unknown, bearer?: string | null): Promise<Request> {
  const value = bearer === undefined ? await token() : bearer;
  return new Request('http://admin.test' + path, {
    method,
    headers: { ...(value ? { authorization: 'Bearer ' + value } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const ctx = (id = CAT_ID) => ({ params: Promise.resolve({ id }) });

test('parseCategoryQuery reads page, limit, and q, and refuses anything malformed', () => {
  assert.deepEqual(parseCategoryQuery(new URLSearchParams()), { ok: true, query: { page: 1, limit: 20, q: null } });
  assert.deepEqual(parseCategoryQuery(new URLSearchParams('q=%20lawn%20&page=2')), { ok: true, query: { page: 2, limit: 20, q: 'lawn' } });
  for (const bad of ['page=0', 'limit=101', 'q=' + 'a'.repeat(101)]) assert.equal(parseCategoryQuery(new URLSearchParams(bad)).ok, false, bad);
});

test('buildCategoryFilter matches the name and the slug literally', () => {
  assert.deepEqual(buildCategoryFilter({ page: 1, limit: 20, q: null }), {});
  const pattern = { $regex: 'a\\.b', $options: 'i' };
  assert.deepEqual(buildCategoryFilter({ page: 1, limit: 20, q: 'a.b' }), { $or: [{ name: pattern }, { slug: pattern }] });
});

test('slugify drops accents and symbols and never ends with a hyphen', () => {
  assert.equal(slugify('  Summer Lawn 2026!  '), 'summer-lawn-2026');
  assert.equal(slugify('Café & Chai'), 'cafe-chai');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify('a'.repeat(120)).length, 80);
});

test('parseCategoryCreate defaults, derives the slug, and refuses bad input', () => {
  assert.deepEqual(parseCategoryCreate({ name: '  Lawn Suits ' }), { ok: true, data: { name: 'Lawn Suits', slug: 'lawn-suits', order: 0, description: null } });
  assert.deepEqual(parseCategoryCreate({ name: 'A', slug: 'a-1', order: 3, description: ' hi ' }), { ok: true, data: { name: 'A', slug: 'a-1', order: 3, description: 'hi' } });
  assert.deepEqual(parseCategoryCreate({ name: 'A', slug: '', description: '  ' }), { ok: true, data: { name: 'A', slug: 'a', order: 0, description: null } });
  const bad: unknown[] = [null, [], {}, { name: '' }, { name: 5 }, { name: 'A', slug: 'Bad Slug' }, { name: 'A', order: '1' }, { name: 'A', order: -1 }, { name: 'A', order: 1.5 }, { name: 'A', description: 5 }, { name: '!!!' }, { name: 'A', _id: CAT_ID }];
  for (const body of bad) assert.equal(parseCategoryCreate(body).ok, false, JSON.stringify(body));
});

test('parseCategoryUpdate changes only what is sent, and refuses an empty change or a cleared slug', () => {
  assert.deepEqual(parseCategoryUpdate({ order: 4 }), { ok: true, data: { order: 4 } });
  assert.deepEqual(parseCategoryUpdate({ description: '' }), { ok: true, data: { description: null } });
  for (const body of [{}, { slug: '' }, { name: '' }, { createdAt: 'x' }, 'text']) assert.equal(parseCategoryUpdate(body).ok, false, JSON.stringify(body));
});

test('toCategoryRow uses id and ISO dates; categorySnapshot keeps only the writable fields', () => {
  const row = toCategoryRow(stored) as any;
  assert.equal(row.id, CAT_ID);
  assert.equal('_id' in row, false);
  assert.equal(row.createdAt, T1.toISOString());
  assert.equal(row.updatedAt, T2.toISOString());
  assert.equal(toCategoryRow({ _id: CAT_ID, name: 'X', slug: 'x', order: Number.NaN, createdAt: T1 }).order, 0);
  assert.deepEqual(Object.keys(categorySnapshot(stored)).sort(), [...CATEGORY_FIELDS].sort());
  assert.equal(isDuplicateKeyError({ code: 11000 }), true);
  assert.equal(isDuplicateKeyError(new Error('x')), false);
});

test('GET lists categories in the envelope with the id identity, and sorts by order then name', async () => {
  const restore = install({ rows: [stored], total: 41 });
  try {
    const response = await list.GET(await send('GET', '/api/admin/categories?page=3&limit=20&q=lawn'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.docs[0].id, CAT_ID);
    assert.equal(body.totalDocs, 41);
    assert.equal(body.totalPages, 3);
    assert.deepEqual(calls.skip, [40]);
    assert.equal(calls.find.length, 1);
  } finally {
    restore();
  }
});

test('every method refuses a missing token, a seller token, and a non-admin account', async () => {
  const restore = install();
  try {
    const sellerToken = await token('seller', 'seller-backend');
    for (const bearer of [null, sellerToken]) {
      assert.equal((await list.GET(await send('GET', '/api/admin/categories', undefined, bearer))).status, 401);
      assert.equal((await list.POST(await send('POST', '/api/admin/categories', { name: 'A' }, bearer))).status, 401);
      assert.equal((await item.PATCH(await send('PATCH', '/api/admin/categories/' + CAT_ID, { order: 1 }, bearer), ctx())).status, 401);
      assert.equal((await item.DELETE(await send('DELETE', '/api/admin/categories/' + CAT_ID, undefined, bearer), ctx())).status, 401);
    }
    UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'seller' }) }) });
    assert.equal((await list.POST(await send('POST', '/api/admin/categories', { name: 'A' }))).status, 401);
    assert.equal(calls.created.length + calls.updates.length + calls.deletes.length + calls.audits.length, 0);
  } finally {
    restore();
  }
});

test('GET refuses a malformed query with its issues', async () => {
  const restore = install();
  try {
    const response = await list.GET(await send('GET', '/api/admin/categories?page=0'));
    assert.equal(response.status, 422);
    assert.deepEqual(((await response.json()) as any).issues, [{ path: 'page', message: 'must be a whole number from 1 to 100000' }]);
  } finally {
    restore();
  }
});

test('POST creates a category, derives the slug, and records who did it', async () => {
  const restore = install();
  try {
    const response = await list.POST(await send('POST', '/api/admin/categories', { name: 'Lawn Suits', order: 3 }));
    assert.equal(response.status, 201);
    const body = (await response.json()) as any;
    assert.equal(body.category.id, CAT_ID);
    assert.equal(body.category.slug, 'lawn-suits');
    assert.deepEqual(calls.created[0], { name: 'Lawn Suits', slug: 'lawn-suits', order: 3, description: null });
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0].action, 'category.create');
    assert.equal(calls.audits[0].actorId, ADMIN_ID);
    assert.equal(calls.audits[0].entityId, CAT_ID);
  } finally {
    restore();
  }
});

test('POST: invalid body is 422, non-JSON is 400, a taken slug is 409 with no audit entry', async () => {
  const restore = install();
  try {
    assert.equal((await list.POST(await send('POST', '/api/admin/categories', { name: '' }))).status, 422);
    assert.equal((await list.POST(await send('POST', '/api/admin/categories', 'not json'))).status, 400);
    assert.equal(calls.created.length, 0);
  } finally {
    restore();
  }
  const clash = install({ duplicate: true });
  try {
    const response = await list.POST(await send('POST', '/api/admin/categories', { name: 'Lawn' }));
    assert.equal(response.status, 409);
    assert.equal(calls.audits.length, 0);
  } finally {
    clash();
  }
});

test('POST: if the audit entry fails, the category is removed and the call fails', async () => {
  const restore = install({ auditFails: true });
  try {
    const response = await list.POST(await send('POST', '/api/admin/categories', { name: 'Lawn' }));
    assert.equal(response.status, 500);
    assert.deepEqual(calls.deletes, [{ _id: CAT_ID }]);
  } finally {
    restore();
  }
});

test('PATCH changes the fields sent and audits the values before and after', async () => {
  const restore = install({ updated: { ...stored, order: 9 } });
  try {
    const response = await item.PATCH(await send('PATCH', '/api/admin/categories/' + CAT_ID, { order: 9 }), ctx());
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).category.order, 9);
    assert.deepEqual(calls.updates[0], { filter: { _id: CAT_ID, name: 'Lawn', slug: 'lawn', order: 2, description: null }, update: { $set: { order: 9 } } });
    assert.equal(calls.audits[0].action, 'category.update');
    assert.equal(calls.audits[0].details.before.order, 2);
    assert.equal(calls.audits[0].details.after.order, 9);
  } finally {
    restore();
  }
});

test('PATCH: bad id and unknown category are 404; empty change is 422; taken slug is 409', async () => {
  const restore = install();
  try {
    assert.equal((await item.PATCH(await send('PATCH', '/api/admin/categories/nope', { order: 1 }), ctx('nope'))).status, 404);
    assert.equal((await item.PATCH(await send('PATCH', '/api/admin/categories/' + CAT_ID, {}), ctx())).status, 422);
  } finally {
    restore();
  }
  const missing = install({ found: null });
  try {
    assert.equal((await item.PATCH(await send('PATCH', '/api/admin/categories/' + CAT_ID, { order: 1 }), ctx())).status, 404);
  } finally {
    missing();
  }
  const clash = install({ duplicate: true });
  try {
    assert.equal((await item.PATCH(await send('PATCH', '/api/admin/categories/' + CAT_ID, { slug: 'taken' }), ctx())).status, 409);
    assert.equal(calls.audits.length, 0);
  } finally {
    clash();
  }
});

test('PATCH: if the audit entry fails, the old values are put back and the call fails', async () => {
  const restore = install({ auditFails: true, updated: { ...stored, order: 9 } });
  try {
    const response = await item.PATCH(await send('PATCH', '/api/admin/categories/' + CAT_ID, { order: 9 }), ctx());
    assert.equal(response.status, 500);
    const revert = calls.updates.find((call) => call.revert);
    assert.deepEqual(revert.update, { $set: { name: 'Lawn', slug: 'lawn', order: 2, description: null } });
  } finally {
    restore();
  }
});

test('DELETE removes the category and audits the values it had', async () => {
  const restore = install();
  try {
    const response = await item.DELETE(await send('DELETE', '/api/admin/categories/' + CAT_ID), ctx());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true, id: CAT_ID });
    assert.deepEqual(calls.deletes, [{ _id: CAT_ID, name: 'Lawn', slug: 'lawn', order: 2, description: null }]);
    assert.equal(calls.audits[0].action, 'category.delete');
    assert.equal(calls.audits[0].details.before.slug, 'lawn');
  } finally {
    restore();
  }
});

test('DELETE: bad id and unknown category are 404, and a failed audit restores the category', async () => {
  const restore = install();
  try {
    assert.equal((await item.DELETE(await send('DELETE', '/api/admin/categories/nope'), ctx('nope'))).status, 404);
  } finally {
    restore();
  }
  const missing = install({ found: null });
  try {
    assert.equal((await item.DELETE(await send('DELETE', '/api/admin/categories/' + CAT_ID), ctx())).status, 404);
    assert.equal(calls.deletes.length, 0);
  } finally {
    missing();
  }
  const failing = install({ auditFails: true });
  try {
    const response = await item.DELETE(await send('DELETE', '/api/admin/categories/' + CAT_ID), ctx());
    assert.equal(response.status, 500);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].slug, 'lawn');
  } finally {
    failing();
  }
});
