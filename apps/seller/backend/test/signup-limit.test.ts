import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { signedClientAddressHeaders } from '@markaz/platform-kit/signed-client-address';
import { User } from '@/lib/services';
import { ROUTE_CAPABILITIES } from '../src/lib/route-capabilities';
import { resetRateLimits } from '../src/lib/storefront/rate-limit';

// SB-F1: POST /api/signup is limited per client address (10 an hour) and per email (3 an hour). Counters in memory, no database.

const SECRET = 'x'.repeat(40);
const ADDRESS_SECRET = 'a'.repeat(40);
const UserModel = User as any;
let signup: (request: Request) => Promise<Response>;
let created: Array<{ email: string }>;
let restore: () => void = () => {};
let seq = 0;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.test';
  process.env.CLIENT_ADDRESS_SIGNING_SECRET = ADDRESS_SECRET;
  signup = (await import('../src/app/api/signup/route')).POST;
});

beforeEach(() => {
  resetRateLimits();
  created = [];
  const saved = { connect: (mongoose as any).connect, exists: UserModel.exists, create: UserModel.create };
  (mongoose as any).connect = async () => mongoose;
  UserModel.exists = async (filter: { email: string }) => (created.some((u) => u.email === filter.email) ? { _id: '65a000000000000000000001' } : null);
  UserModel.create = async (doc: { email: string }) => {
    created.push(doc);
    return { _id: '65a000000000000000000001', ...doc };
  };
  restore = () => {
    (mongoose as any).connect = saved.connect;
    UserModel.exists = saved.exists;
    UserModel.create = saved.create;
  };
});

afterEach(() => restore());

/** A signup as the portal sends it: with the browser's address signed, or with none. */
function join(email: string, address: string | null = null): Promise<Response> {
  const headers = { 'content-type': 'application/json', ...(address === null ? {} : signedClientAddressHeaders(ADDRESS_SECRET, 'account-portal', address)) };
  return signup(new Request('http://seller.test/api/signup', { method: 'POST', headers, body: JSON.stringify({ name: 'Ali', email, password: 'longenough' }) }));
}
const fresh = (): string => 'limit' + ++seq + '@example.com';

async function assertLimited(res: Response): Promise<void> {
  assert.equal(res.status, 429);
  const retryAfter = Number(res.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 3600, 'Retry-After is the rest of the hour window: ' + retryAfter);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { errors: [{ message: 'Too many attempts. Please wait and try again.' }], code: 'RATE_LIMITED', retryAfterSeconds: retryAfter });
}

test('one email gets three tries an hour, whatever its capitals and whatever address they come from', async () => {
  assert.equal((await join('sana@example.com', '203.0.113.1')).status, 201);
  assert.equal((await join('Sana@Example.com', '203.0.113.2')).status, 409);
  assert.equal((await join('sana@example.com', '203.0.113.3')).status, 409);
  await assertLimited(await join('SANA@example.com', '203.0.113.4'));
  assert.equal(created.length, 1);
  assert.equal((await join(fresh(), '203.0.113.4')).status, 201, 'another email is untouched');
});

test('one signed address gets ten signups an hour; the eleventh creates nothing and another address is untouched', async () => {
  for (let i = 0; i < 10; i += 1) assert.equal((await join(fresh(), '203.0.113.9')).status, 201, 'signup ' + i);
  await assertLimited(await join(fresh(), '203.0.113.9'));
  assert.equal(created.length, 10);
  assert.equal((await join(fresh(), '203.0.113.10')).status, 201);
});

test('an address that cannot be known is not one shared bucket: only the email limit applies', async () => {
  for (let i = 0; i < 12; i += 1) assert.equal((await join(fresh())).status, 201, 'signup ' + i);
});

test('a body that is refused counts nothing, and the route stays public in the capability map', async () => {
  const bad = () => signup(new Request('http://seller.test/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ali@example.com' }) }));
  for (let i = 0; i < 5; i += 1) assert.ok((await bad()).status < 429);
  assert.equal((await join('ali@example.com')).status, 201);
  assert.equal(ROUTE_CAPABILITIES['signup POST'], 'public');
});
