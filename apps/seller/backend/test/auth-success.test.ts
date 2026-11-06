import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { hashPassword, signSession, verifySession, User } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';

// The admin backend's session audience. A token minted for the seller backend must be refused there.
const ADMIN_AUDIENCE = 'admin-backend';
const SECRET = 'x'.repeat(40);
const OID = '65a000000000000000000001';
const PASSWORD = 'correct-horse-battery';

type UserStub = { findDoc?: Record<string, unknown> | null; exists?: boolean };

const UserModel = User as any;
let signup: (request: Request) => Promise<Response>;
let login: (request: Request) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  signup = (await import('../src/app/api/signup/route')).POST;
  login = (await import('../src/app/api/users/login/route')).POST;
});

/** Stubs the connection and the User calls the routes make. Returns the restore function. */
function installStubs(stub: UserStub, updates: unknown[], created: unknown[]): () => void {
  const originals = {
    findOne: UserModel.findOne,
    exists: UserModel.exists,
    create: UserModel.create,
    updateOne: UserModel.updateOne,
  };
  const originalConnect = (mongoose as any).connect;
  (mongoose as any).connect = async () => mongoose;
  UserModel.findOne = () => ({ select: () => ({ exec: async () => stub.findDoc ?? null }) });
  UserModel.exists = async () => (stub.exists ? { _id: OID } : null);
  UserModel.create = async (doc: Record<string, unknown>) => {
    created.push(doc);
    return { _id: OID, ...doc };
  };
  UserModel.updateOne = async (_filter: unknown, update: unknown) => {
    updates.push(update);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  return () => {
    (mongoose as any).connect = originalConnect;
    UserModel.findOne = originals.findOne;
    UserModel.exists = originals.exists;
    UserModel.create = originals.create;
    UserModel.updateOne = originals.updateOne;
  };
}

async function storedUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: OID,
    name: 'Ali',
    email: 'ali@example.com',
    role: 'seller',
    store: null,
    passwordHash: await hashPassword(PASSWORD),
    loginAttempts: 0,
    lockUntil: null,
    ...overrides,
  };
}

function json(body: unknown): Request {
  return new Request('http://seller.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('signup creates a seller, returns 201 with a session the seller audience accepts', async () => {
  const updates: unknown[] = [];
  const created: unknown[] = [];
  const restore = installStubs({ exists: false }, updates, created);
  try {
    const response = await signup(json({ name: 'Ali', email: 'Ali@Example.com', password: 'longenough' }));
    assert.equal(response.status, 201);
    const body = (await response.json()) as { success: boolean; token: string; user: Record<string, unknown> };
    assert.equal(body.success, true);
    assert.equal(body.user.id, OID);
    assert.equal(body.user.email, 'ali@example.com');
    assert.equal(body.user.role, 'seller');
    assert.equal('passwordHash' in body.user, false);
    const claims = await verifySession(body.token, SECRET, SELLER_AUDIENCE);
    assert.equal(claims.sub, OID);
    const stored = created[0] as { passwordHash: string; email: string };
    assert.equal(stored.email, 'ali@example.com');
    assert.notEqual(stored.passwordHash, 'longenough', 'the password must be stored hashed');
  } finally {
    restore();
  }
});

test('signup for an existing email is refused with 409', async () => {
  const restore = installStubs({ exists: true }, [], []);
  try {
    const response = await signup(json({ name: 'Ali', email: 'ali@example.com', password: 'longenough' }));
    assert.equal(response.status, 409);
  } finally {
    restore();
  }
});

test('login with the right password returns 200, a session, and resets the attempt counter', async () => {
  const updates: unknown[] = [];
  const restore = installStubs({ findDoc: await storedUser({ loginAttempts: 3 }) }, updates, []);
  try {
    const response = await login(json({ email: 'ali@example.com', password: PASSWORD }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { token: string; user: Record<string, unknown> };
    assert.equal(body.user.id, OID);
    assert.equal('passwordHash' in body.user, false);
    const claims = await verifySession(body.token, SECRET, SELLER_AUDIENCE);
    assert.equal(claims.sub, OID);
    assert.deepEqual(updates[0], { $set: { loginAttempts: 0, lockUntil: null } });
  } finally {
    restore();
  }
});

test('login with a wrong password is refused with 401 and records one more attempt', async () => {
  const updates: unknown[] = [];
  const restore = installStubs({ findDoc: await storedUser() }, updates, []);
  try {
    const response = await login(json({ email: 'ali@example.com', password: 'wrong-password-value' }));
    assert.equal(response.status, 401);
    const update = updates[0] as { $set: { loginAttempts: number } };
    assert.equal(update.$set.loginAttempts, 1);
  } finally {
    restore();
  }
});

test('login for an unknown email is refused with 401 and does not reveal which part was wrong', async () => {
  const restore = installStubs({ findDoc: null }, [], []);
  try {
    const response = await login(json({ email: 'nobody@example.com', password: PASSWORD }));
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.ok(text.includes('Invalid email or password'), 'the message must match the wrong-password case: ' + text);
  } finally {
    restore();
  }
});

test('a locked account is refused with 423 before any password check', async () => {
  const restore = installStubs(
    { findDoc: await storedUser({ loginAttempts: 8, lockUntil: new Date(Date.now() + 60_000) }) },
    [],
    [],
  );
  try {
    const response = await login(json({ email: 'ali@example.com', password: PASSWORD }));
    assert.equal(response.status, 423);
  } finally {
    restore();
  }
});

test('a token from a successful login is refused by the admin audience (cross-backend)', async () => {
  const restore = installStubs({ findDoc: await storedUser() }, [], []);
  try {
    const response = await login(json({ email: 'ali@example.com', password: PASSWORD }));
    const body = (await response.json()) as { token: string };
    await assert.rejects(verifySession(body.token, SECRET, ADMIN_AUDIENCE));
    await verifySession(body.token, SECRET, SELLER_AUDIENCE);
  } finally {
    restore();
  }
});

test('a seller-minted token is refused by the admin audience even with the same secret', async () => {
  const token = await signSession({ sub: OID, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  await assert.rejects(verifySession(token, SECRET, ADMIN_AUDIENCE));
});
