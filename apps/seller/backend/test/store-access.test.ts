import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Store } from '@/lib/services';
import type { AuthContext } from '@/lib/auth';
import { listActiveMemberships, resolveOwnedStoreId, resolveStoreAccess, setMembershipListLoader, setMembershipLoader } from '../src/lib/data-plane';

// Sprint 8 (S8-B2, D-118): resolveOwnedStoreId is membership-aware. It answers { storeId, role, isOwner } for the owner or an ACTIVE member; an invited, disabled or
// removed member and a stranger get the same 403 as before; a member is refused (403 NOT_OWNER_YET) by every route that names no capability, and with one only when their
// role has it. Models are stubbed; the member row is read through the loader seam, live, on every call.

const OWNER = '65a000000000000000000001';
const MEMBER = '65a000000000000000000002';
const STRANGER = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';

const StoreModel = Store as any;

let owners: Record<string, string>;
/** The member rows by `store:user`; null/absent is no active membership. The loader reads this on every call. */
let members: Record<string, { role: unknown; status: string } | undefined>;
let lookups: number;
let saved: { exists: unknown; findOne: unknown };

const ctxOf = (userId: string, actor: 'seller' | 'admin' = 'seller'): AuthContext => ({
  userId,
  userObjectId: new mongoose.Types.ObjectId(userId),
  role: actor,
  actor,
  tokenVersion: 0,
});
const req = (storeId?: string) => new NextRequest('http://seller.test/api/x', { headers: storeId ? { 'x-store-id': storeId } : {} });

beforeEach(() => {
  owners = { [STORE_A]: OWNER, [STORE_B]: STRANGER };
  members = {};
  lookups = 0;
  saved = { exists: StoreModel.exists, findOne: StoreModel.findOne };
  StoreModel.exists = async (filter: any) => (owners[String(filter._id)] === String(filter.owner) ? { _id: filter._id } : null);
  StoreModel.findOne = (filter: any) => {
    const q: any = { sort: () => q, select: () => q, lean: async () => (Object.entries(owners).find(([, owner]) => owner === String(filter.owner)) ? { _id: STORE_A } : null) };
    return q;
  };
  setMembershipLoader(async (storeId, userId) => {
    lookups += 1;
    const row = members[storeId + ':' + userId];
    return row && row.status === 'active' ? { role: row.role } : null;
  });
});

afterEach(() => {
  StoreModel.exists = saved.exists;
  StoreModel.findOne = saved.findOne;
  setMembershipLoader(null);
  setMembershipListLoader(null);
});

const refused = (promise: Promise<unknown>, status: number, code?: string) =>
  assert.rejects(promise, (err: any) => err.status === status && (code === undefined || err.errorCode === code), 'status ' + status + (code ? ' ' + code : ''));

test('the owner: { storeId, role owner, isOwner true }, no membership lookup is made', async () => {
  const access = await resolveStoreAccess(req(STORE_A), ctxOf(OWNER), null);
  assert.deepEqual(access, { storeId: STORE_A, role: 'owner', isOwner: true });
  assert.equal(lookups, 0, 'an owner never reaches the member table');
});

test('the old shape still works: resolveOwnedStoreId answers the store id alone, for the owner, exactly as before', async () => {
  assert.equal(await resolveOwnedStoreId(req(STORE_A), ctxOf(OWNER), null), STORE_A);
  assert.equal(await resolveOwnedStoreId(req(), ctxOf(OWNER), { store: { equals: STORE_A } }), STORE_A);
  assert.equal(await resolveOwnedStoreId(req(), ctxOf(OWNER), null), STORE_A, 'the fallback is the first OWNED store');
  await refused(resolveOwnedStoreId(req(), ctxOf(OWNER), null, { requireStore: true }), 400, 'STORE_ID_REQUIRED');
  await refused(resolveOwnedStoreId(req(STORE_A), ctxOf(OWNER), { store: { equals: STORE_B } }), 403);
});

test('a stranger (no membership) and a foreign store id are 403, exactly as before; a malformed id is 403 and nothing is read', async () => {
  await refused(resolveStoreAccess(req(STORE_B), ctxOf(OWNER), null), 403);
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(STRANGER), null), 403);
  await refused(resolveStoreAccess(req('not-an-id'), ctxOf(OWNER), null), 403);
  const before = lookups;
  await refused(resolveStoreAccess(req('not-an-id'), ctxOf(MEMBER), null), 403);
  assert.equal(lookups, before, 'a malformed id never reaches the member table');
});

test('an invited member, a disabled member and a removed member are strangers: the same 403, even for a route that names a capability', async () => {
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'invited' };
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'disabled' };
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
  delete members[STORE_A + ':' + MEMBER];
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
  await assert.rejects(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null), (err: any) => err.status === 403 && err.errorCode !== 'NOT_OWNER_YET', 'the message of a stranger, not of a member');
});

test('an active member WITHOUT a capability on the route is refused 403 NOT_OWNER_YET: no route gains a member before it was swept', async () => {
  for (const role of ['manager', 'staff', 'support']) {
    members[STORE_A + ':' + MEMBER] = { role, status: 'active' };
    await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null), 403, 'NOT_OWNER_YET');
    await refused(resolveOwnedStoreId(req(STORE_A), ctxOf(MEMBER), null), 403, 'NOT_OWNER_YET');
    await refused(resolveOwnedStoreId(req(), ctxOf(MEMBER), { store: { equals: STORE_A } }), 403, 'NOT_OWNER_YET');
  }
});

test('an active member WITH the capability gets { storeId, role, isOwner false }; one whose role lacks it is 403 CAPABILITY_DENIED', async () => {
  members[STORE_A + ':' + MEMBER] = { role: 'staff', status: 'active' };
  assert.deepEqual(await resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'products.write' }), { storeId: STORE_A, role: 'staff', isOwner: false });
  assert.equal(await resolveOwnedStoreId(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), STORE_A);
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'returns.read' }), 403, 'CAPABILITY_DENIED');
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'team.manage' }), 403, 'CAPABILITY_DENIED');
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'active' };
  assert.equal((await resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'settings.tax' })).role, 'manager');
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'settings.payments' }), 403, 'CAPABILITY_DENIED');
  members[STORE_A + ':' + MEMBER] = { role: 'support', status: 'active' };
  assert.equal((await resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'returns.write' })).role, 'support');
});

test('the owner passes any capability that exists, and a capability this code does not know is denied even to the owner', async () => {
  for (const capability of ['team.manage', 'settings.payments', 'orders.read', 'go_live'] as const) {
    assert.equal((await resolveStoreAccess(req(STORE_A), ctxOf(OWNER), null, { capability })).role, 'owner');
  }
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(OWNER), null, { capability: 'orders.destroy' as never }), 403, 'CAPABILITY_DENIED');
});

test('a member row with a role this code does not know (corrupt, or "owner") is no member at all: 403 as a stranger', async () => {
  for (const role of ['owner', 'admin', '', undefined, null, 'MANAGER']) {
    members[STORE_A + ':' + MEMBER] = { role, status: 'active' };
    await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
  }
});

test('membership is read on EVERY request: a member disabled between two requests is refused on the very next one', async () => {
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'active' };
  assert.equal((await resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' })).role, 'manager');
  members[STORE_A + ':' + MEMBER]!.status = 'disabled';
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
  members[STORE_A + ':' + MEMBER]!.status = 'active';
  members[STORE_A + ':' + MEMBER]!.role = 'support';
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'products.write' }), 403, 'CAPABILITY_DENIED');
  assert.equal(lookups, 3, 'one lookup per request, never cached');
});

test('a member of one store is a stranger in another', async () => {
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'active' };
  await refused(resolveStoreAccess(req(STORE_B), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
});

test('the x-store-id header and where must agree; a member naming two stores is refused', async () => {
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'active' };
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), { store: { equals: STORE_B } }, { capability: 'orders.read' }), 403);
});

test('a member with no store named never falls back to a store: the fallback is the OWNED stores only', async () => {
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'active' };
  await refused(resolveStoreAccess(req(), ctxOf(MEMBER), null, { capability: 'orders.read' }), 404);
});

test('an admin session is unchanged: it may name any store and is not a member of anything', async () => {
  assert.deepEqual(await resolveStoreAccess(req(STORE_B), ctxOf(OWNER, 'admin'), null), { storeId: STORE_B, role: null, isOwner: false });
  assert.equal(lookups, 0);
});

test('fail closed: with no way to look a member up (no loader, no open connection) a non-owner is a stranger, 403 as before', async () => {
  setMembershipLoader(null);
  members[STORE_A + ':' + MEMBER] = { role: 'manager', status: 'active' };
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
});

test('fail closed: a lookup that throws is no membership (403), never a 500 and never access', async () => {
  setMembershipLoader(async () => {
    throw new Error('database down');
  });
  await refused(resolveStoreAccess(req(STORE_A), ctxOf(MEMBER), null, { capability: 'orders.read' }), 403);
});

test('the list of a user active memberships: only ACTIVE rows with a staff role, read live', async () => {
  const rows = [
    { store: STORE_A, role: 'manager' },
    { store: STORE_B, role: 'owner' },
    { store: '65a000000000000000000013', role: 'support' },
  ];
  setMembershipListLoader(async (userId) => (userId === MEMBER ? rows : []));
  assert.deepEqual(await listActiveMemberships(ctxOf(MEMBER)), [
    { storeId: STORE_A, role: 'manager' },
    { storeId: '65a000000000000000000013', role: 'support' },
  ]);
  assert.deepEqual(await listActiveMemberships(ctxOf(STRANGER)), []);
  assert.deepEqual(await listActiveMemberships(ctxOf(MEMBER, 'admin')), [], 'an admin session has no memberships');
  setMembershipListLoader(async () => {
    throw new Error('down');
  });
  assert.deepEqual(await listActiveMemberships(ctxOf(MEMBER)), []);
});
