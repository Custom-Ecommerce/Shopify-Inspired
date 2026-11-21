import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NotificationOutbox, PlatformSettingsModel, Store, SubscriptionPlanModel, User } from '@/lib/services';
import {
  billingLinkFor,
  formatMailDate,
  sendPaymentClaimed,
  sendPaymentConfirmed,
  sendPaymentRejected,
  sendSubscriptionExpired,
  sendSubscriptionExpiring,
} from '../src/lib/subscription-emails';

// Sprint 6 EP-14 (S6-B4, D-118): the emails of manual subscription payments, through the outbox. Models are stubbed; nothing leaves (the first send
// finds nothing to claim). The unique dedupe key of the real index is enforced by the stub.

const SELLER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';

const OutboxModel = NotificationOutbox as any;
const UserModel = User as any;
const StoreModel = Store as any;
const PlanModel = SubscriptionPlanModel as any;
const SettingsModel = PlatformSettingsModel as any;

let outbox: Array<Record<string, any>>;
let users: Record<string, Record<string, any>>;
let settingsDoc: Record<string, any> | null;
let stores: Array<{ _id: string; owner: string }>;
let restore: () => void = () => {};

const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const lean = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  const saved = {
    outbox: Object.fromEntries(['create', 'findOne', 'findOneAndUpdate'].map((name) => [name, OutboxModel[name]])),
    userFindById: UserModel.findById,
    storeFindOne: StoreModel.findOne,
    planFindOne: PlanModel.findOne,
    settings: SettingsModel.findOne,
    env: { APP_BASE_URL_SELLER: process.env.APP_BASE_URL_SELLER, EMAIL_PROVIDER: process.env.EMAIL_PROVIDER },
  };
  outbox = [];
  users = { [SELLER]: { _id: SELLER, name: 'Ayesha <b>Khan</b>', email: 'ayesha@example.com' } };
  settingsDoc = { supportEmail: 'billing@markazify.test' };
  stores = [{ _id: STORE, owner: SELLER }];
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  delete process.env.EMAIL_PROVIDER;

  OutboxModel.create = async (doc: Record<string, any>) => {
    if (doc.dedupeKey !== undefined && outbox.some((row) => row.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    outbox.push(row);
    return row;
  };
  OutboxModel.findOne = (filter: any) => lean(() => outbox.find((row) => row.dedupeKey === filter.dedupeKey) ?? null);
  OutboxModel.findOneAndUpdate = () => lean(() => null);
  UserModel.findById = (id: unknown) => lean(() => users[String(id)] ?? null);
  StoreModel.findOne = (filter: any) => lean(() => stores.find((row) => row.owner === String(filter.owner)) ?? null);
  PlanModel.findOne = (filter: any) => lean(() => ({ key: filter.key, name: filter.key === 'growth' ? 'Growth' : 'Starter' }));
  SettingsModel.findOne = () => lean(() => settingsDoc);

  restore = () => {
    for (const [name, fn] of Object.entries(saved.outbox)) OutboxModel[name] = fn;
    UserModel.findById = saved.userFindById;
    StoreModel.findOne = saved.storeFindOne;
    PlanModel.findOne = saved.planFindOne;
    SettingsModel.findOne = saved.settings;
    for (const [key, value] of Object.entries(saved.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
});

afterEach(() => restore());

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: '65a0000000000000000e0001',
  seller: SELLER,
  planKey: 'growth',
  amountRs: 2500,
  method: 'jazzcash',
  reference: 'TX-77812',
  periodEnd: new Date('2026-12-20T10:00:00.000Z'),
  reason: null as string | null,
  ...overrides,
});

test('a claimed payment goes to the platform\'s support address with the seller, plan, amount, method and reference; the typed text is escaped in the HTML', async () => {
  await sendPaymentClaimed(payment({ reference: '<img src=x onerror=alert(1)>' }));
  assert.equal(outbox.length, 1);
  const row = outbox[0]!;
  assert.deepEqual([row.template, row.to, row.dedupeKey, row.status], ['payment_claimed', 'billing@markazify.test', 'payment_claimed:65a0000000000000000e0001', 'queued']);
  assert.match(row.subject, /Rs\. 2,500/);
  for (const part of ['ayesha@example.com', 'Growth', 'Rs. 2,500', 'JazzCash']) assert.ok(row.bodyText.includes(part), part);
  assert.equal(row.bodyHtml.includes('<img'), false);
  assert.ok(row.bodyHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(row.bodyHtml.includes('<b>Khan</b>'), false, 'the seller\'s name is escaped too');
});

test('a claimed payment is queued once: a second call is a duplicate and writes nothing', async () => {
  await sendPaymentClaimed(payment());
  await sendPaymentClaimed(payment());
  assert.equal(outbox.length, 1);
});

test('no support email in the settings: nothing is queued; an unknown seller: nothing either', async () => {
  settingsDoc = {};
  await sendPaymentClaimed(payment());
  assert.equal(outbox.length, 0);
  settingsDoc = { supportEmail: 'billing@markazify.test' };
  await sendPaymentClaimed(payment({ seller: '65a000000000000000000099' }));
  assert.equal(outbox.length, 0);
});

test('a confirmed payment tells the seller the plan, the amount, the end of the period and links to their billing page', async () => {
  await sendPaymentConfirmed(payment());
  const row = outbox[0]!;
  assert.deepEqual([row.template, row.to, row.dedupeKey], ['payment_confirmed', 'ayesha@example.com', 'payment_confirmed:65a0000000000000000e0001']);
  for (const part of ['Growth', 'Rs. 2,500', '20 December 2026', 'https://seller.markazify.com/s/' + STORE + '/billing']) assert.ok(row.bodyText.includes(part), part);
  await sendPaymentConfirmed(payment());
  assert.equal(outbox.length, 1, 'once per payment');
});

test('a confirmed payment without a period end is not announced (there is nothing true to say)', async () => {
  await sendPaymentConfirmed(payment({ periodEnd: null }));
  assert.equal(outbox.length, 0);
});

test('a rejected payment carries the admin\'s reason; a voided one has its own key, so both can be sent', async () => {
  await sendPaymentRejected(payment({ reason: 'The amount did not match' }), 'rejected');
  await sendPaymentRejected(payment({ reason: 'Payment bounced' }), 'voided');
  assert.deepEqual(outbox.map((row) => row.dedupeKey), ['payment_rejected:65a0000000000000000e0001', 'payment_voided:65a0000000000000000e0001']);
  assert.ok(outbox[0]!.bodyText.includes('The amount did not match'));
  assert.ok(outbox[1]!.bodyText.includes('Payment bounced'));
  await sendPaymentRejected(payment({ reason: null }), 'rejected');
  assert.equal(outbox.length, 2, 'the same payment is not told twice');
});

test('without a reason the email says so instead of leaving a hole', async () => {
  await sendPaymentRejected(payment({ reason: '   ' }), 'rejected');
  assert.ok(outbox[0]!.bodyText.includes('No reason was given.'));
});

test('the billing link falls back to words when the portal address or the store is missing', async () => {
  assert.equal(await billingLinkFor(SELLER), 'https://seller.markazify.com/s/' + STORE + '/billing');
  delete process.env.APP_BASE_URL_SELLER;
  assert.equal(await billingLinkFor(SELLER), 'your Markazify dashboard');
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  stores = [];
  assert.equal(await billingLinkFor(SELLER), 'your Markazify dashboard');
  await sendPaymentConfirmed(payment());
  assert.equal(outbox.length, 1, 'still sent: the link is words');
});

test('the 7 day reminder and the expired email are keyed by subscription AND period: once each, and a new period has its own', async () => {
  const sub = { subscriptionId: '65a0000000000000000f0001', seller: SELLER, planKey: 'growth', periodEnd: new Date('2026-11-25T00:00:00.000Z') };
  const first = await sendSubscriptionExpiring(sub);
  assert.equal(first?.outcome, 'queued');
  assert.equal((await sendSubscriptionExpiring(sub))?.outcome, 'duplicate');
  assert.equal((await sendSubscriptionExpiring({ ...sub, periodEnd: new Date('2026-12-25T00:00:00.000Z') }))?.outcome, 'queued', 'the next period');
  assert.equal((await sendSubscriptionExpired(sub))?.outcome, 'queued');
  assert.equal((await sendSubscriptionExpired(sub))?.outcome, 'duplicate');
  assert.deepEqual(
    outbox.map((row) => row.dedupeKey),
    [
      'subscription_expiring:65a0000000000000000f0001:' + sub.periodEnd.getTime(),
      'subscription_expiring:65a0000000000000000f0001:' + new Date('2026-12-25T00:00:00.000Z').getTime(),
      'subscription_expired:65a0000000000000000f0001:' + sub.periodEnd.getTime(),
    ],
  );
  assert.ok(outbox[0]!.bodyText.includes('25 November 2026'));
  assert.match(outbox[2]!.bodyText, /Nothing was deleted/);
});

test('a seller with no email address gets no subscription email and the job is told nothing was queued', async () => {
  users[SELLER] = { _id: SELLER, name: 'No Email' };
  const sub = { subscriptionId: '65a0000000000000000f0001', seller: SELLER, planKey: 'growth', periodEnd: new Date('2026-11-25T00:00:00.000Z') };
  assert.equal(await sendSubscriptionExpiring(sub), null);
  assert.equal(await sendSubscriptionExpired(sub), null);
  assert.equal(outbox.length, 0);
});

test('mail dates are in UTC: late evening UTC is still that day, and a leap day prints as itself', () => {
  assert.equal(formatMailDate(new Date('2026-12-20T23:59:00.000Z')), '20 December 2026');
  assert.equal(formatMailDate(new Date('2028-02-29T00:00:00.000Z')), '29 February 2028');
  assert.equal(formatMailDate(new Date('2027-01-01T00:00:00.000Z')), '1 January 2027');
});
