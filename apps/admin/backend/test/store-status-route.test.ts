import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AuditLog, Store, User, registerSyncOutboxModel, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { parseStatusChange, planStatusChange, revertUpdate } from '@/lib/governance';

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const STORE_ID = '65a000000000000000000010';
const StoreModel = Store as any;
const UserModel = User as any;
const AuditModel = AuditLog as any;

let POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  POST = (await import('../src/app/api/admin/stores/[id]/status/route')).POST;
});

const outbox: Array<Record<string, any>> = [];
let outboxFails = false;
const audits: Array<Record<string, any>> = [];
let auditFails = false;
const updates: Array<{ filter: any; update: any }> = [];
let matched = 1;

function chain(value: unknown): any {
  const c: any = { sort: () => c, lean: () => c, exec: async () => value };
  return c;
}

const fakeOutbox = {
  create: async (doc: Record<string, any>) => {
    if (outboxFails) throw new Error('outbox down');
    outbox.push(doc);
    return doc;
  },
  find: () => chain([]),
  findOne: () => chain(null),
  updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
  updateMany: async () => ({ matchedCount: 0, modifiedCount: 0 }),
};

function install(storeDoc: Record<string, unknown> | null): () => void {
  const originals = {
    connect: (mongoose as any).connect,
    findById: StoreModel.findById,
    updateOne: StoreModel.updateOne,
    userFindById: UserModel.findById,
    auditCreate: AuditModel.create,
  };
  (mongoose as any).connect = async () => mongoose;
  StoreModel.findById = () => ({ select: () => ({ lean: async () => storeDoc }) });
  StoreModel.updateOne = async (filter: any, update: any) => {
    updates.push({ filter, update });
    return { matchedCount: updates.length === 1 ? matched : 1, modifiedCount: 1 };
  };
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin' }) }) });
  AuditModel.create = async (doc: Record<string, any>) => {
    if (auditFails) throw new Error('audit down');
    audits.push(doc);
    return { _id: '65a000000000000000000099' };
  };
  registerSyncOutboxModel(fakeOutbox as any);
  outbox.length = 0;
  audits.length = 0;
  updates.length = 0;
  outboxFails = false;
  auditFails = false;
  matched = 1;
  return () => {
    (mongoose as any).connect = originals.connect;
    StoreModel.findById = originals.findById;
    StoreModel.updateOne = originals.updateOne;
    UserModel.findById = originals.userFindById;
    AuditModel.create = originals.auditCreate;
  };
}

async function post(body: unknown, token?: string | null, id = STORE_ID): Promise<Response> {
  const bearer = token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : token;
  const request = new Request('http://admin.test/api/admin/stores/' + id + '/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

const active = { _id: STORE_ID, name: 'Looms', status: 'active' };
const suspendedDoc = { _id: STORE_ID, name: 'Looms', status: 'suspended', suspensionReason: 'old', suspendedAt: new Date('2026-10-01T00:00:00Z'), statusChangedAt: new Date('2026-10-01T00:00:00Z') };

test('parseStatusChange needs a status and a reason of 3 to 500 characters', () => {
  assert.equal(parseStatusChange({ status: 'suspended' }).ok, false);
  assert.equal(parseStatusChange({ status: 'suspended', reason: 'no' }).ok, false);
  assert.equal(parseStatusChange({ status: 'archived', reason: 'because' }).ok, false);
  assert.equal(parseStatusChange({ status: 'active', reason: 'x'.repeat(501) }).ok, false);
  assert.deepEqual(parseStatusChange({ status: 'active', reason: ' cleared ', note: '  ' }), { ok: true, data: { status: 'active', reason: 'cleared', note: null } });
});

test('planStatusChange follows the transition rules', () => {
  const now = new Date();
  const input = (status: 'active' | 'suspended') => ({ status, reason: 'because', note: null });
  assert.equal(planStatusChange('active', input('suspended'), now).ok, true);
  assert.equal(planStatusChange('suspended', input('active'), now).ok, true);
  assert.equal(planStatusChange('pending', input('active'), now).ok, true);
  assert.equal(planStatusChange('pending', input('suspended'), now).ok, false);
  assert.equal(planStatusChange('active', input('active'), now).ok, false);
  assert.equal(planStatusChange('archived', input('active'), now).ok, false);
});

test('revertUpdate restores what was there and unsets what was not', () => {
  const undo = revertUpdate({ status: 'active', suspensionReason: null, suspensionNote: null, suspendedAt: null, statusChangedAt: null });
  assert.deepEqual(undo.$set, { status: 'active' });
  assert.deepEqual(Object.keys(undo.$unset ?? {}).sort(), ['statusChangedAt', 'suspendedAt', 'suspensionNote', 'suspensionReason']);
});

test('no token, or a seller token, is 401 and nothing is written', async () => {
  const restore = install(active);
  try {
    assert.equal((await post({ status: 'suspended', reason: 'policy' }, null)).status, 401);
    const seller = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
    assert.equal((await post({ status: 'suspended', reason: 'policy' }, seller)).status, 401);
    assert.equal(updates.length, 0);
  } finally {
    restore();
  }
});

test('a missing reason is 422 and nothing is written', async () => {
  const restore = install(active);
  try {
    const response = await post({ status: 'suspended' });
    assert.equal(response.status, 422);
    assert.equal(updates.length, 0);
    assert.equal(audits.length, 0);
    assert.equal(outbox.length, 0);
  } finally {
    restore();
  }
});

test('suspending an active store writes the status, audits it with before and after, and queues it for the seller', async () => {
  const restore = install(active);
  try {
    const response = await post({ status: 'suspended', reason: 'repeated chargebacks', note: 'ticket 4411' });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.store.status, 'suspended');
    assert.equal(body.store.suspensionReason, 'repeated chargebacks');
    assert.equal(body.queued.revision, 1);

    assert.deepEqual(updates[0].filter, { _id: STORE_ID, status: 'active' });
    assert.equal(updates[0].update.$set.status, 'suspended');
    assert.equal(updates[0].update.$set.suspensionNote, 'ticket 4411');

    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'store.suspend');
    assert.equal(audits[0].entity, 'store');
    assert.equal(audits[0].entityId, STORE_ID);
    assert.equal(audits[0].actorId, ADMIN_ID);
    assert.equal(audits[0].details.reason, 'repeated chargebacks');
    assert.equal(audits[0].details.before.status, 'active');
    assert.equal(audits[0].details.after.status, 'suspended');

    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].target, 'seller');
    assert.equal(outbox[0].group, 'governance');
    assert.deepEqual(outbox[0].payload, { status: 'suspended' });
  } finally {
    restore();
  }
});

test('activating a suspended store clears the suspension fields and audits the reason', async () => {
  const restore = install(suspendedDoc);
  try {
    const response = await post({ status: 'active', reason: 'dispute resolved' });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.deepEqual([body.store.status, body.store.suspensionReason, body.store.suspendedAt], ['active', null, null]);
    assert.deepEqual(Object.keys(updates[0].update.$unset).sort(), ['suspendedAt', 'suspensionNote', 'suspensionReason']);
    assert.equal(audits[0].action, 'store.activate');
    assert.equal(audits[0].details.before.suspensionReason, 'old');
    assert.equal(audits[0].details.reason, 'dispute resolved');
  } finally {
    restore();
  }
});

test('a change that does not apply to the current status is 409 and writes nothing', async () => {
  const restore = install(active);
  try {
    const response = await post({ status: 'active', reason: 'already fine' });
    assert.equal(response.status, 409);
    assert.equal(updates.length, 0);
    assert.equal(audits.length, 0);
  } finally {
    restore();
  }
});

test('a store changed by another operator meanwhile is 409 and is not audited or queued', async () => {
  const restore = install(active);
  try {
    matched = 0;
    const response = await post({ status: 'suspended', reason: 'policy breach' });
    assert.equal(response.status, 409);
    assert.equal(audits.length, 0);
    assert.equal(outbox.length, 0);
  } finally {
    restore();
  }
});

test('an unknown or malformed store is 404', async () => {
  const restore = install(null);
  try {
    assert.equal((await post({ status: 'suspended', reason: 'policy' })).status, 404);
    assert.equal((await post({ status: 'suspended', reason: 'policy' }, undefined, 'nope')).status, 404);
  } finally {
    restore();
  }
});

test('if the queue write fails the store is put back and the call fails', async () => {
  const restore = install(active);
  try {
    outboxFails = true;
    const response = await post({ status: 'suspended', reason: 'policy breach' });
    assert.equal(response.status, 500);
    assert.equal(updates.length, 2);
    assert.equal(updates[1].update.$set.status, 'active');
    assert.equal(outbox.length, 0);
  } finally {
    restore();
  }
});

test('if the audit write fails the store is put back, nothing is queued, and the call fails', async () => {
  const restore = install(active);
  try {
    auditFails = true;
    const response = await post({ status: 'suspended', reason: 'policy breach' });
    assert.equal(response.status, 500);
    assert.equal(updates[1].update.$set.status, 'active');
    assert.equal(outbox.length, 0);
  } finally {
    restore();
  }
});
