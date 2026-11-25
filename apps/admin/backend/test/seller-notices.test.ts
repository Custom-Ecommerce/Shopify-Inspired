import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import * as notificationsNs from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { AuditLog, User } from '@/lib/workspace';
import { changeSellerStatus, sellerStatusSteps } from '@/lib/admin-seller-status';
import {
  buildAccountNotice,
  buildStorePausedNotice,
  noticeSteps,
  queueAccountNotice,
  queueStorePausedNotice,
  NOTICE_APP_NAME,
} from '@/lib/seller-notices';

// Sprint 6 EP-12.US02.T03 (CO-82): the paused, suspended and reactivated emails are queued at the status change. The outbox and the seller
// backend call are replaced; no database, no network.

const { renderTemplate } = unwrapCjs(notificationsNs) as typeof notificationsNs;

const AT = new Date('2026-11-20T10:00:00.000Z');
const SELLER = '65a000000000000000000001';
const ADMIN = '65a000000000000000000003';
const STORE = '65a000000000000000000011';
const UserModel = User as any;
const AuditModel = AuditLog as any;

let jobs: Array<{ label: string; job: () => Promise<unknown> }>;
let queued: Array<Record<string, any>>;
let users: Record<string, Record<string, any>>;
let failEnqueue: boolean;
let restore: () => void = () => {};

beforeEach(() => {
  jobs = [];
  queued = [];
  failEnqueue = false;
  users = {
    [SELLER]: { _id: SELLER, role: 'seller', email: 'ayesha@example.com', name: 'Ayesha' },
    [ADMIN]: { _id: ADMIN, role: 'admin', email: 'op@example.com', name: 'Op' },
  };
  const saved = {
    run: noticeSteps.run,
    enqueue: noticeSteps.enqueue,
    loadUser: noticeSteps.loadUser,
    apply: sellerStatusSteps.applyInSellerBackend,
    findById: UserModel.findById,
    findOneAndUpdate: UserModel.findOneAndUpdate,
    audit: AuditModel.create,
    connect: (mongoose as any).connect,
  };
  // The job is kept, not run, so each test says when "after the response" happens.
  noticeSteps.run = (label, job) => {
    jobs.push({ label, job });
  };
  noticeSteps.enqueue = async (input) => {
    if (failEnqueue) throw new Error('outbox down');
    queued.push(input as unknown as Record<string, any>);
    return null;
  };
  noticeSteps.loadUser = async (id) => (users[id] ? { name: users[id]!.name, email: users[id]!.email } : null);
  sellerStatusSteps.applyInSellerBackend = async (_adminId, input) => ({ userId: input.userId, status: input.status, changed: true });
  const chain = (value: () => unknown) => {
    const q: any = { select: () => q, lean: async () => value() };
    return q;
  };
  UserModel.findById = (id: unknown) => chain(() => (users[String(id)] ? { ...users[String(id)] } : null));
  UserModel.findOneAndUpdate = (filter: any, update: any) =>
    chain(() => {
      const row = users[String(filter._id)];
      if (!row) return null;
      Object.assign(row, update.$set);
      return { ...row };
    });
  AuditModel.create = async () => ({ _id: new mongoose.Types.ObjectId() });
  (mongoose as any).connect = async () => mongoose;
  restore = () => {
    noticeSteps.run = saved.run;
    noticeSteps.enqueue = saved.enqueue;
    noticeSteps.loadUser = saved.loadUser;
    sellerStatusSteps.applyInSellerBackend = saved.apply;
    UserModel.findById = saved.findById;
    UserModel.findOneAndUpdate = saved.findOneAndUpdate;
    AuditModel.create = saved.audit;
    (mongoose as any).connect = saved.connect;
  };
});

afterEach(() => restore());

const runJobs = async () => {
  for (const { job } of jobs) await job();
};

// ------------------------------------------------------------------------------------------------------------- the builders

test('a suspended account gets an account_suspended email with the operator reason; the name falls back to "there"', () => {
  const mail = buildAccountNotice({ sellerId: SELLER, status: 'suspended', reason: 'Fake products reported', name: 'Ayesha', email: 'ayesha@example.com', at: AT })!;
  assert.equal(mail.template, 'account_suspended');
  assert.equal(mail.to, 'ayesha@example.com');
  assert.deepEqual(mail.vars, { appName: NOTICE_APP_NAME, customerName: 'Ayesha', suspensionReason: 'Fake products reported' });
  assert.equal(mail.dedupeKey, 'account_suspended:' + SELLER + ':' + AT.getTime());
  assert.equal(buildAccountNotice({ sellerId: SELLER, status: 'suspended', reason: 'Reason', name: undefined, email: 'a@example.com', at: AT })!.vars.customerName, 'there');
  assert.equal(buildAccountNotice({ sellerId: SELLER, status: 'suspended', reason: 'Reason', name: '   ', email: 'a@example.com', at: AT })!.vars.customerName, 'there');
});

test('a reactivated account gets an account_reactivated email, with no reason', () => {
  const mail = buildAccountNotice({ sellerId: SELLER, status: 'active', reason: null, name: 'Ayesha', email: 'ayesha@example.com', at: AT })!;
  assert.equal(mail.template, 'account_reactivated');
  assert.deepEqual(mail.vars, { appName: NOTICE_APP_NAME, customerName: 'Ayesha' });
  assert.equal(mail.dedupeKey, 'account_reactivated:' + SELLER + ':' + AT.getTime());
});

test('nothing is built without an address, or for a suspension without a reason', () => {
  for (const email of [undefined, null, '', 'not an email', 42]) {
    assert.equal(buildAccountNotice({ sellerId: SELLER, status: 'active', reason: null, name: 'A', email, at: AT }), null, String(email));
  }
  assert.equal(buildAccountNotice({ sellerId: SELLER, status: 'suspended', reason: null, name: 'A', email: 'a@example.com', at: AT }), null);
  assert.equal(buildAccountNotice({ sellerId: SELLER, status: 'suspended', reason: '  ', name: 'A', email: 'a@example.com', at: AT }), null);
});

test('a paused store gets a store_paused email for its owner, keyed by the store and the time', () => {
  const mail = buildStorePausedNotice({ storeId: STORE, storeName: ' Zara Lawn ', reason: 'Counterfeit goods', ownerEmail: 'ayesha@example.com', at: AT })!;
  assert.equal(mail.template, 'store_paused');
  assert.equal(mail.to, 'ayesha@example.com');
  assert.deepEqual(mail.vars, { storeName: 'Zara Lawn', suspensionReason: 'Counterfeit goods' });
  assert.equal(mail.store, STORE);
  assert.equal(mail.dedupeKey, 'store_paused:' + STORE + ':' + AT.getTime());
  assert.equal(buildStorePausedNotice({ storeId: STORE, storeName: 'Zara', reason: 'Why', ownerEmail: undefined, at: AT }), null);
  assert.equal(buildStorePausedNotice({ storeId: STORE, storeName: 'Zara', reason: ' ', ownerEmail: 'a@example.com', at: AT }), null);
  assert.equal(buildStorePausedNotice({ storeId: STORE, storeName: '  ', reason: 'Why', ownerEmail: 'a@example.com', at: AT }), null);
});

test('every built email renders with its template: no variable is missing', () => {
  const suspended = buildAccountNotice({ sellerId: SELLER, status: 'suspended', reason: 'Reason', name: 'A', email: 'a@example.com', at: AT })!;
  const active = buildAccountNotice({ sellerId: SELLER, status: 'active', reason: null, name: 'A', email: 'a@example.com', at: AT })!;
  const paused = buildStorePausedNotice({ storeId: STORE, storeName: 'Zara', reason: 'Why', ownerEmail: 'a@example.com', at: AT })!;
  for (const mail of [suspended, active, paused]) assert.doesNotThrow(() => renderTemplate(mail.template, mail.vars), mail.template);
});

// ---------------------------------------------------------------------------------------------------------------- queueing

test('queueAccountNotice queues after the response, not before, and never throws', async () => {
  queueAccountNotice({ sellerId: SELLER, status: 'suspended', reason: 'Fake products', name: 'Ayesha', email: 'ayesha@example.com', at: AT });
  assert.equal(queued.length, 0, 'nothing is sent while the response is being made');
  assert.equal(jobs.length, 1);
  await runJobs();
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.template, 'account_suspended');

  // a seller without an email queues nothing
  jobs = [];
  queueAccountNotice({ sellerId: SELLER, status: 'active', reason: null, name: 'A', email: undefined, at: AT });
  assert.equal(jobs.length, 0);

  // a step that throws at queue time is swallowed
  noticeSteps.run = () => {
    throw new Error('after() is not available');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => queueAccountNotice({ sellerId: SELLER, status: 'active', reason: null, name: 'A', email: 'a@example.com', at: AT }));
  } finally {
    console.error = quiet;
  }
});

test('queueStorePausedNotice reads the owner after the response and queues one email', async () => {
  queueStorePausedNotice({ storeId: STORE, storeName: 'Zara Lawn', ownerId: SELLER, reason: 'Counterfeit goods', at: AT });
  assert.equal(queued.length, 0);
  assert.equal(jobs.length, 1);
  await runJobs();
  assert.equal(queued.length, 1);
  assert.deepEqual([queued[0]!.template, queued[0]!.to, queued[0]!.vars.storeName], ['store_paused', 'ayesha@example.com', 'Zara Lawn']);

  // no owner id, or an owner that is gone: nothing is queued
  jobs = [];
  queued = [];
  queueStorePausedNotice({ storeId: STORE, storeName: 'Zara Lawn', ownerId: null, reason: 'Why', at: AT });
  assert.equal(jobs.length, 0);
  queueStorePausedNotice({ storeId: STORE, storeName: 'Zara Lawn', ownerId: '65a0000000000000000000ff', reason: 'Why', at: AT });
  await runJobs();
  assert.equal(queued.length, 0);
});

// ------------------------------------------------------------------------------------------- at the seller status change

test('suspending a seller queues the suspended email with the reason; unsuspending queues the reactivated one', async () => {
  const suspended = await changeSellerStatus({ adminId: ADMIN, sellerId: SELLER, status: 'suspended', reason: 'Fake products reported' });
  assert.equal(suspended.changed, true);
  assert.equal(jobs.length, 1);
  await runJobs();
  assert.equal(queued[0]!.template, 'account_suspended');
  assert.equal(queued[0]!.vars.suspensionReason, 'Fake products reported');
  assert.equal(queued[0]!.to, 'ayesha@example.com');

  jobs = [];
  queued = [];
  const back = await changeSellerStatus({ adminId: ADMIN, sellerId: SELLER, status: 'active', reason: null });
  assert.equal(back.changed, true);
  await runJobs();
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.template, 'account_reactivated');
  assert.equal('suspensionReason' in queued[0]!.vars, false);
});

test('a status that is already set sends no email, and a failed seller backend call sends none either', async () => {
  users[SELLER]!.accountStatus = 'suspended';
  const same = await changeSellerStatus({ adminId: ADMIN, sellerId: SELLER, status: 'suspended', reason: 'Fake products reported' });
  assert.equal(same.changed, false);
  assert.equal(jobs.length, 0);

  users[SELLER]!.accountStatus = 'active';
  sellerStatusSteps.applyInSellerBackend = async () => {
    throw new Error('seller backend down');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => changeSellerStatus({ adminId: ADMIN, sellerId: SELLER, status: 'suspended', reason: 'Fake products reported' }));
  } finally {
    console.error = quiet;
  }
  assert.equal(jobs.length, 0);
});

test('a failing outbox never fails the status change: the change is made, the email is logged and dropped', async () => {
  failEnqueue = true;
  const result = await changeSellerStatus({ adminId: ADMIN, sellerId: SELLER, status: 'suspended', reason: 'Fake products reported' });
  assert.equal(result.changed, true);
  assert.equal(users[SELLER]!.accountStatus, 'suspended');
  // the job that runs after the response throws; the real runAfterResponse catches and logs it
  await assert.rejects(() => runJobs());
});
