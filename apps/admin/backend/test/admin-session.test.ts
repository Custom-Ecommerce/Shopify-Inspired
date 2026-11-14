import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { hashPassword, signSession, verifySession, User } from '@/lib/workspace';
import { ADMIN_AUDIENCE, parseLogin } from '@/lib/admin-auth';
import { validateAdminSeed } from '@/lib/admin-seed';

const SECRET = 'x'.repeat(40);
const SELLER_AUDIENCE = 'seller-backend';
const OID = '65a000000000000000000001';
const PASSWORD = 'correct-horse-battery-staple';
const UserModel = User as any;

let loginPOST: (request: Request) => Promise<Response>;
let meGET: (request: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  loginPOST = (await import('../src/app/api/admin/session/route')).POST;
  meGET = (await import('../src/app/api/admin/me/route')).GET;
});

interface Stub {
  findDoc?: Record<string, any> | null;
  meDoc?: Record<string, any> | null;
}

function install(stub: Stub, updates: unknown[]): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    findOne: UserModel.findOne,
    findById: UserModel.findById,
    updateOne: UserModel.updateOne,
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findOne = () => ({ select: () => ({ exec: async () => stub.findDoc ?? null }) });
  UserModel.findById = () => ({ select: () => ({ lean: async () => stub.meDoc ?? null }) });
  UserModel.updateOne = async (_filter: unknown, update: unknown) => {
    updates.push(update);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  return () => {
    (mongoose as any).connect = originals.connect;
    UserModel.findOne = originals.findOne;
    UserModel.findById = originals.findById;
    UserModel.updateOne = originals.updateOne;
  };
}

async function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: OID,
    name: 'Op Erator',
    email: 'op@example.com',
    role: 'admin',
    store: null,
    passwordHash: await hashPassword(PASSWORD),
    loginAttempts: 0,
    lockUntil: null,
    ...overrides,
  };
}

function loginRequest(payload: unknown): Request {
  return new Request('http://admin.test/api/admin/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function meRequest(token?: string): Request {
  return new Request('http://admin.test/api/admin/me', { headers: token ? { authorization: 'Bearer ' + token } : {} });
}

test('an admin signs in: 200, a token the admin audience accepts, no secret fields, no lockout counter written (D-097)', async () => {
  const updates: unknown[] = [];
  const restore = install({ findDoc: await userDoc({ loginAttempts: 3 }) }, updates);
  try {
    const response = await loginPOST(loginRequest({ email: 'Op@Example.com', password: PASSWORD }));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { token: string; user: Record<string, unknown> };
    assert.equal(payload.user.id, OID);
    assert.equal(payload.user.role, 'admin');
    assert.equal('passwordHash' in payload.user, false);
    const claims = await verifySession(payload.token, SECRET, ADMIN_AUDIENCE);
    assert.equal(claims.sub, OID);
    assert.equal(updates.length, 0);
  } finally {
    restore();
  }
});

test('a wrong password is refused with 401 and writes no lockout counter (the throttle counts it, D-097)', async () => {
  const updates: unknown[] = [];
  const restore = install({ findDoc: await userDoc() }, updates);
  try {
    const response = await loginPOST(loginRequest({ email: 'op@example.com', password: 'not-the-password' }));
    assert.equal(response.status, 401);
    assert.equal(updates.length, 0);
  } finally {
    restore();
  }
});

test('an unknown email gets the same 401 message and changes nothing', async () => {
  const updates: unknown[] = [];
  const restore = install({ findDoc: null }, updates);
  try {
    const response = await loginPOST(loginRequest({ email: 'nobody@example.com', password: PASSWORD }));
    assert.equal(response.status, 401);
    assert.ok((await response.text()).includes('Invalid email or password'));
    assert.equal(updates.length, 0);
  } finally {
    restore();
  }
});

test('a seller account cannot sign in to the admin backend, even with the right password', async () => {
  const restore = install({ findDoc: await userDoc({ role: 'seller' }) }, []);
  try {
    const response = await loginPOST(loginRequest({ email: 'op@example.com', password: PASSWORD }));
    assert.equal(response.status, 401);
  } finally {
    restore();
  }
});

test('a stored lockUntil no longer locks the account: the throttle is the only lock (D-097)', async () => {
  const updates: unknown[] = [];
  const restore = install({ findDoc: await userDoc({ loginAttempts: 8, lockUntil: new Date(Date.now() + 60000) }) }, updates);
  try {
    const response = await loginPOST(loginRequest({ email: 'op@example.com', password: PASSWORD }));
    assert.equal(response.status, 200);
    assert.equal(updates.length, 0);
  } finally {
    restore();
  }
});

test('sign-in without a configured secret is refused with 503', async () => {
  const restore = install({ findDoc: await userDoc() }, []);
  delete process.env.ADMIN_AUTH_SECRET;
  try {
    const response = await loginPOST(loginRequest({ email: 'op@example.com', password: PASSWORD }));
    assert.equal(response.status, 503);
  } finally {
    process.env.ADMIN_AUTH_SECRET = SECRET;
    restore();
  }
});

test('a body that is not JSON is 400, and an invalid email is 422 naming the field', async () => {
  const restore = install({ findDoc: null }, []);
  try {
    assert.equal((await loginPOST(loginRequest('not json'))).status, 400);
    const response = await loginPOST(loginRequest({ email: 'nope', password: PASSWORD }));
    assert.equal(response.status, 422);
    const payload = (await response.json()) as { issues: Array<{ path: string }> };
    assert.ok(payload.issues.some((issue) => issue.path === 'email'));
  } finally {
    restore();
  }
});

test('me returns the operator for a valid admin token', async () => {
  const restore = install({ meDoc: await userDoc() }, []);
  try {
    const token = await signSession({ sub: OID, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
    const response = await meGET(meRequest(token));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { user: { id: string; email: string } };
    assert.equal(payload.user.id, OID);
    assert.equal(payload.user.email, 'op@example.com');
  } finally {
    restore();
  }
});

test('me refuses no token, a garbage token, and a token minted for the seller audience', async () => {
  const restore = install({ meDoc: await userDoc() }, []);
  try {
    assert.equal((await meGET(meRequest())).status, 401);
    assert.equal((await meGET(meRequest('not.a.token'))).status, 401);
    const sellerToken = await signSession({ sub: OID, role: 'admin' }, SECRET, SELLER_AUDIENCE);
    assert.equal((await meGET(meRequest(sellerToken))).status, 401);
  } finally {
    restore();
  }
});

test('an operator who was demoted after signing in is refused on the next call', async () => {
  const restore = install({ meDoc: await userDoc({ role: 'seller' }) }, []);
  try {
    const token = await signSession({ sub: OID, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
    assert.equal((await meGET(meRequest(token))).status, 401);
  } finally {
    restore();
  }
});

test('an admin token is refused by the seller audience (cross-backend)', async () => {
  const token = await signSession({ sub: OID, role: 'admin' }, SECRET, ADMIN_AUDIENCE);
  await assert.rejects(verifySession(token, SECRET, SELLER_AUDIENCE));
});

test('the login body check bounds sizes and names the failing fields', () => {
  assert.equal(parseLogin({ email: 'a@b.co', password: 'x' }).ok, true);
  const bad = parseLogin({ email: 'nope', password: 'x'.repeat(2000) });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(bad.issues.map((issue) => issue.path).sort(), ['email', 'password']);
});

test('the first-operator values need a valid email, a name, and a 12-character password', () => {
  assert.deepEqual(validateAdminSeed({ email: 'op@example.com', name: 'Op', password: 'twelve-chars!' }), []);
  assert.equal(validateAdminSeed({ email: 'nope', name: '', password: 'short' }).length, 3);
});
