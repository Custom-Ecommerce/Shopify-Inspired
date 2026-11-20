import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

// EP-07.US03.T03: GET/PATCH /api/users/me/notification-prefs. The User model is stubbed; no database.

const SECRET = 'x'.repeat(40);
const SELLER = '65a000000000000000000001';
const ADMIN = '65a000000000000000000003';

const UserModel = User as any;
const AuditModel = AuditLog as any;

let users: Array<Record<string, any>> = [];
let audits: Array<Record<string, any>> = [];
let tokenSeller = '';
let tokenAdmin = '';
let prefsGET: (r: NextRequest) => Promise<Response>;
let prefsPATCH: (r: NextRequest) => Promise<Response>;
let restore: () => void = () => {};

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenSeller = await signSession({ sub: SELLER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, SECRET, SELLER_AUDIENCE);
  const mod = await import('../src/app/api/users/me/notification-prefs/route');
  prefsGET = mod.GET;
  prefsPATCH = mod.PATCH;
});

beforeEach(() => {
  const saved = { connect: (mongoose as any).connect, findById: UserModel.findById, findOneAndUpdate: UserModel.findOneAndUpdate, audit: AuditModel.create };
  // An account created before Sprint 4: no notificationPrefs stored.
  users = [{ _id: SELLER, role: 'seller', email: 'seller@example.com' }];
  audits = [];
  (mongoose as any).connect = async () => mongoose;
  const chain = (value: () => unknown) => ({ select: () => ({ lean: async () => value() }) });
  UserModel.findById = (id: unknown) => chain(() => users.find((u) => u._id === String(id)) ?? null);
  UserModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const user = users.find((u) => u._id === String(filter._id) && u.role === filter.role);
      if (!user) return null;
      for (const [path, value] of Object.entries(update.$set as Record<string, unknown>)) {
        const [head, key] = path.split('.');
        user[head!] = { ...(user[head!] ?? {}), [key!]: value };
      }
      return { ...user };
    });
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.findById = saved.findById;
    UserModel.findOneAndUpdate = saved.findOneAndUpdate;
    AuditModel.create = saved.audit;
  };
});

afterEach(() => restore());

const get = (token: string) => new NextRequest('http://seller.test/api/users/me/notification-prefs', { headers: { authorization: 'Bearer ' + token } });
const patch = (token: string, body: string) =>
  new NextRequest('http://seller.test/api/users/me/notification-prefs', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body,
  });

test('a seller who never saved the switches reads both as on', async () => {
  const response = await prefsGET(get(tokenSeller));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { prefs: { emailNewOrder: true, emailLowStock: true } });
});

test('one switch is changed, the other is kept, and the change is audited', async () => {
  const response = await prefsPATCH(patch(tokenSeller, JSON.stringify({ emailLowStock: false })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { prefs: { emailNewOrder: true, emailLowStock: false } });
  assert.equal(users[0]!.notificationPrefs.emailLowStock, false);
  assert.equal(audits.length, 1);

  const again = await prefsGET(get(tokenSeller));
  assert.deepEqual(await again.json(), { prefs: { emailNewOrder: true, emailLowStock: false } });
});

test('a bad body is refused with 400 and the field name, and nothing is written', async () => {
  const cases: Array<[string, string]> = [
    ['not json', 'body'],
    ['{}', 'body'],
    [JSON.stringify({ emailNewOrder: 'no' }), 'emailNewOrder'],
    [JSON.stringify({ inAppAlerts: false }), 'inAppAlerts'],
  ];
  for (const [body, field] of cases) {
    const response = await prefsPATCH(patch(tokenSeller, body));
    assert.equal(response.status, 400, body);
    assert.equal(((await response.json()) as { field: string }).field, field, body);
  }
  assert.equal(users[0]!.notificationPrefs, undefined);
});

test('an admin session cannot read or change a seller switch', async () => {
  assert.equal((await prefsGET(get(tokenAdmin))).status, 403);
  assert.equal((await prefsPATCH(patch(tokenAdmin, JSON.stringify({ emailNewOrder: false })))).status, 403);
});

test('no session is 401', async () => {
  assert.equal((await prefsGET(new NextRequest('http://seller.test/api/users/me/notification-prefs'))).status, 401);
});
