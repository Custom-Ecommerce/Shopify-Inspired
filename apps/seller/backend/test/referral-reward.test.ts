import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  AuditLog,
  NotificationOutbox,
  PlatformSettingsModel,
  Referral,
  Store,
  Subscription,
  SubscriptionCredit,
  SubscriptionPayment,
  SubscriptionPlanModel,
  User,
} from '@/lib/services';
import { sendReferralRewarded, sendReferralSignedUp } from '../src/lib/referral-emails';
import { samePersonAmong } from '../src/lib/referral-reward';
import { isRunningPaidPeriod } from '../src/lib/subscription-credits';
import { confirmPayment, voidPayment } from '../src/lib/subscription-payment-admin';
import { addMonthsUtc } from '../src/lib/subscription-period';

// Sprint 8 (S8-B6, D-118): the referral reward. confirmPayment and voidPayment run against an in-memory world that emulates the compare-and-set and the unique
// indexes of the referral slots and of the credits. No database.

type Row = Record<string, any>;

const ADMIN = '65a000000000000000000009';
const REFERRER = '65a000000000000000000001';
const REFERRED = '65a000000000000000000002';
const REFERRED_2 = '65a000000000000000000004';
const NOW = new Date('2026-11-20T10:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);

let payments: Row[];
let subs: Row[];
let referrals: Row[];
let credits: Row[];
let users: Row[];
let stores: Row[];
let audits: Row[];
let outbox: Row[];
let settings: Row | null;
let failSubscriptionWrite: boolean;
let seq = 0;
let restore: () => void = () => {};

const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const oid = (): string => '65a0000000000000000' + String(++seq).padStart(5, '0');

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, wanted]) => {
    const actual = row[key];
    if (wanted === null) return actual === null || actual === undefined;
    if (typeof wanted === 'object' && !(wanted instanceof Date)) {
      if ('$in' in wanted) return (wanted.$in as unknown[]).some((v) => (v === null ? actual === null || actual === undefined : String(v) === String(actual)));
      if ('$ne' in wanted) return String(actual) !== String(wanted.$ne);
      if ('$gt' in wanted) return typeof actual === 'number' && actual > wanted.$gt;
    }
    return String(actual) === String(wanted);
  });
}

const query = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};

function apply(row: Row, change: Row): void {
  Object.assign(row, change.$set ?? {});
  if (change.$inc?.revision) row.revision = (row.revision ?? 0) + change.$inc.revision;
}

/** find, findOne, findOneAndUpdate, updateOne, updateMany, countDocuments and create over one array. */
function fake(model: any, rows: () => Row[], check: (row: Row, change: Row) => void = () => {}, onCreate: (doc: Row) => void = () => {}) {
  model.find = (filter: Row) => query(() => rows().filter((r) => matches(r, filter)).map((r) => ({ ...r })));
  model.findOne = (filter: Row) => query(() => {
    const row = rows().find((r) => matches(r, filter));
    return row ? { ...row } : null;
  });
  model.findOneAndUpdate = (filter: Row, change: Row) => query(() => {
    const row = rows().find((r) => matches(r, filter));
    if (!row) return null;
    check(row, change);
    apply(row, change);
    return { ...row };
  });
  model.updateOne = async (filter: Row, change: Row) => {
    const row = rows().find((r) => matches(r, filter));
    if (row) apply(row, change);
    return { matchedCount: row ? 1 : 0 };
  };
  model.updateMany = async (filter: Row, change: Row) => {
    const found = rows().filter((r) => matches(r, filter));
    for (const row of found) apply(row, change);
    return { modifiedCount: found.length };
  };
  model.countDocuments = async (filter: Row) => rows().filter((r) => matches(r, filter)).length;
  model.create = async (doc: Row) => {
    onCreate(doc);
    const row = { _id: oid(), revision: 0, ...doc };
    rows().push(row);
    return { ...row };
  };
}

const METHODS = ['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany', 'countDocuments', 'create', 'findById'];
const MODELS = [SubscriptionPayment, Subscription, Referral, SubscriptionCredit, User, Store, SubscriptionPlanModel, PlatformSettingsModel, AuditLog, NotificationOutbox] as any[];

const GROWTH = { _id: 'p1', key: 'growth', name: 'Growth' };

function payment(seller: string, extra: Row = {}): Row {
  const row = {
    _id: oid(),
    seller,
    planKey: 'growth',
    amountRs: 2500,
    status: 'claimed',
    isOpen: true,
    method: 'jazzcash',
    reference: 'TX',
    revision: 0,
    createdAt: NOW,
    ...extra,
  };
  payments.push(row);
  return row;
}

function sub(seller: string, extra: Row = {}): Row {
  const row = { _id: oid(), seller, planKey: 'growth', status: 'active', periodStart: at(-10), currentPeriodEnd: at(20), graceUntil: null, trialEndsAt: null, source: 'manual', cancelAtPeriodEnd: false, pendingPlanKey: null, revision: 0, ...extra };
  subs.push(row);
  return row;
}

function referral(referred = REFERRED, extra: Row = {}): Row {
  const row = { _id: oid(), referrer: REFERRER, referred, status: 'pending', monthsRewarded: 0, rewardedAt: null, createdAt: at(-5), ...extra };
  referrals.push(row);
  return row;
}

beforeEach(() => {
  payments = [];
  subs = [];
  referrals = [];
  credits = [];
  users = [
    { _id: REFERRER, name: 'Sana Khan', email: 'sana@example.com', phone: '+923001111111', accountStatus: 'active' },
    { _id: REFERRED, name: 'Bilal Ahmed', email: 'bilal@example.com', accountStatus: 'active' },
    { _id: REFERRED_2, name: 'Zoya', email: 'zoya@example.com', accountStatus: 'active' },
  ];
  stores = [];
  audits = [];
  outbox = [];
  settings = null;
  failSubscriptionWrite = false;

  const saved = MODELS.map((model) => ({ model, methods: Object.fromEntries(METHODS.map((m) => [m, model[m]])) }));
  const connect = (mongoose as any).connect;
  (mongoose as any).connect = async () => mongoose;
  fake(SubscriptionPayment, () => payments);
  fake(Subscription, () => subs, () => {
    if (failSubscriptionWrite) throw new Error('write failed');
  });
  fake(Referral, () => referrals, (row, change) => {
    // The unique partial index {referrer, rewardMonth, rewardSlot}.
    const set = change.$set ?? {};
    if (typeof set.rewardSlot === 'number' && referrals.some((other) => other !== row && other.referrer === row.referrer && other.rewardMonth === set.rewardMonth && other.rewardSlot === set.rewardSlot)) throw dup();
  });
  fake(SubscriptionCredit, () => credits, () => {}, (doc) => {
    if (credits.some((row) => String(row.referral) === String(doc.referral))) throw dup();
  });
  fake(User, () => users);
  (User as any).findById = (id: unknown) => query(() => users.find((u) => u._id === String(id)) ?? null);
  fake(Store, () => stores);
  fake(SubscriptionPlanModel, () => [GROWTH]);
  (PlatformSettingsModel as any).findOne = () => query(() => settings);
  (AuditLog as any).create = async (doc: Row) => {
    audits.push(doc);
    return { _id: oid() };
  };
  (NotificationOutbox as any).create = async (doc: Row) => {
    if (outbox.some((row) => row.dedupeKey === doc.dedupeKey)) throw dup();
    outbox.push({ _id: new mongoose.Types.ObjectId(), ...doc });
    return outbox.at(-1);
  };
  (NotificationOutbox as any).findOne = (filter: Row) => query(() => outbox.find((row) => row.dedupeKey === filter.dedupeKey) ?? null);
  (NotificationOutbox as any).findOneAndUpdate = () => query(() => null);
  restore = () => {
    (mongoose as any).connect = connect;
    for (const { model, methods } of saved) Object.assign(model, methods);
  };
});

afterEach(() => restore());

const confirm = (row: Row, now: Date = NOW) => confirmPayment({ paymentId: row._id, amountRs: row.amountRs, reason: 'Money received' }, ADMIN, now);
const voided = (row: Row) => voidPayment({ paymentId: row._id, reason: 'Wrong transfer' }, ADMIN, NOW);
const actions = (): string[] => audits.map((entry) => String(entry.action));
const subOf = (seller: string): Row => subs.find((row) => String(row.seller) === seller)!;

test('the referred seller\'s first confirmed payment rewards the referrer: the row is rewarded and the running paid period is one month longer', async () => {
  const mine = sub(REFERRER);
  const row = referral();
  await confirm(payment(REFERRED));
  assert.deepEqual([row.status, row.monthsRewarded, row.rewardMonth, row.rewardSlot], ['rewarded', 1, '2026-11', 1]);
  assert.equal(row.rewardedAt.getTime(), NOW.getTime());
  assert.equal(subOf(REFERRER).currentPeriodEnd.getTime(), addMonthsUtc(at(20), 1).getTime());
  assert.equal(subOf(REFERRER).planKey, mine.planKey);
  assert.equal(subOf(REFERRER).revision, 1);
  assert.equal(credits.length, 1);
  assert.ok(credits[0]!.usedAt);
  assert.equal(credits[0]!.usedByPayment, null);
  assert.ok(actions().includes('referral.rewarded'));
  assert.ok(actions().includes('subscription.referral_extended'));
});

test('a double confirm and two confirms at once reward once', async () => {
  sub(REFERRER);
  referral();
  const first = payment(REFERRED);
  const results = await Promise.allSettled([confirm(first), confirm(first)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(() => confirm(first), (err: any) => err.code === 'PAYMENT_NOT_CLAIMED');
  assert.equal(credits.length, 1);
  assert.equal(subOf(REFERRER).currentPeriodEnd.getTime(), addMonthsUtc(at(20), 1).getTime());
});

test('no reward for a second payment, for a payment of 0, or for a seller nobody referred', async () => {
  const row = referral();
  payment(REFERRED, { status: 'confirmed', isOpen: false });
  await confirm(payment(REFERRED));
  assert.equal(row.status, 'pending');

  const other = referral(REFERRED_2);
  await confirm(payment(REFERRED_2, { amountRs: 0 }));
  assert.equal(other.status, 'pending');
  assert.equal(credits.length, 0);
});

test('a payment of 0 confirmed earlier does not count: the first payment with a real amount still rewards', async () => {
  const row = referral();
  payment(REFERRED, { status: 'confirmed', amountRs: 0 });
  await confirm(payment(REFERRED));
  assert.equal(row.status, 'rewarded');
});

test('referralRewardMonths 0: nothing happens, the row stays pending', async () => {
  settings = { referralRewardMonths: 0 };
  sub(REFERRER);
  const row = referral();
  await confirm(payment(REFERRED));
  assert.equal(row.status, 'pending');
  assert.equal(credits.length, 0);
  assert.equal(subOf(REFERRER).currentPeriodEnd.getTime(), at(20).getTime());
  assert.equal(actions().some((a) => a.startsWith('referral.')), false);
});

test('the monthly cap: past it the row is capped and stays unrewarded; the next UTC month has room again', async () => {
  settings = { referralMonthlyCap: 1 };
  referral('65a0000000000000000000f1', { status: 'rewarded', rewardMonth: '2026-11', rewardSlot: 1 });
  const row = referral();
  await confirm(payment(REFERRED));
  assert.equal(row.status, 'capped');
  assert.equal(row.rewardedAt, null);
  assert.equal(credits.length, 0);
  assert.ok(actions().includes('referral.capped'));

  const december = referral(REFERRED_2);
  await confirm(payment(REFERRED_2), new Date('2026-12-01T00:00:00.000Z'));
  assert.deepEqual([december.status, december.rewardMonth, december.rewardSlot], ['rewarded', '2026-12', 1]);
  assert.equal(row.status, 'capped', 'a capped referral is never rewarded later');
});

test('two rewards of one referrer at once cannot both take the last place of the month', async () => {
  settings = { referralMonthlyCap: 1 };
  const a = referral();
  const b = referral(REFERRED_2);
  await Promise.all([confirm(payment(REFERRED)), confirm(payment(REFERRED_2))]);
  assert.deepEqual([a.status, b.status].sort(), ['capped', 'rewarded']);
  assert.equal(credits.length, 1);
});

test('a self-referral found at reward time, by a store\'s contact email or WhatsApp number, is refused', async () => {
  stores.push({ _id: oid(), owner: REFERRED, storefront: { contactEmail: 'Sana+shop@example.com' } });
  const row = referral();
  await confirm(payment(REFERRED));
  assert.equal(row.status, 'refused');

  stores = [{ _id: oid(), owner: REFERRED_2, storefront: { whatsappNumber: '03001111111' } }];
  const other = referral(REFERRED_2);
  await confirm(payment(REFERRED_2));
  assert.equal(other.status, 'refused');
  assert.equal(credits.length, 0);
  assert.equal(audits.filter((e) => e.action === 'referral.refused').length, 2);
});

test('the identities compared are every pair of the two sides', () => {
  assert.equal(samePersonAmong([{ email: 'a@x.test' }, { phone: '03002222222' }], [{ email: 'b@x.test' }, { phone: '+923002222222' }]), true);
  assert.equal(samePersonAmong([{ email: 'a@x.test' }], [{ email: 'b@x.test' }, {}]), false);
});

test('a suspended or blocked referrer gets nothing', async () => {
  for (const [status, who] of [['suspended', REFERRED], ['blocked', REFERRED_2]] as const) {
    users[0]!.accountStatus = status;
    const row = referral(who);
    await confirm(payment(who));
    assert.equal(row.status, 'refused', status);
  }
  assert.equal(credits.length, 0);
});

test('a referrer on Free or in a trial holds the months; their next confirmed payment adds them to the paid period, and no plan is granted before', async () => {
  const trial = sub(REFERRER, { status: 'trial', currentPeriodEnd: null, trialEndsAt: at(5) });
  referral();
  await confirm(payment(REFERRED));
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.usedAt, null);
  assert.deepEqual([trial.status, trial.currentPeriodEnd, trial.revision], ['trial', null, 0]);

  const own = payment(REFERRER);
  await confirm(own);
  assert.equal(subOf(REFERRER).currentPeriodEnd.getTime(), addMonthsUtc(addMonthsUtc(NOW, 1), 1).getTime());
  assert.equal(subOf(REFERRER).status, 'active');
  assert.equal(String(credits[0]!.usedByPayment), own._id);
  assert.equal(own.periodEnd.getTime(), addMonthsUtc(NOW, 1).getTime(), 'the payment still bought one month');
});

test('a seller with no subscription at all gets none from a reward', async () => {
  referral();
  await confirm(payment(REFERRED));
  assert.equal(subs.filter((row) => String(row.seller) === REFERRER).length, 0);
  assert.equal(credits[0]!.usedAt, null);
});

test('what counts as a running paid period', () => {
  const base = { planKey: 'growth', status: 'active', currentPeriodEnd: at(1) };
  assert.equal(isRunningPaidPeriod(base, NOW), true);
  assert.equal(isRunningPaidPeriod({ ...base, status: 'cancelled' }, NOW), true);
  for (const other of [{ status: 'trial' }, { status: 'grace' }, { status: 'expired' }, { planKey: 'free' }, { currentPeriodEnd: at(-1) }, { currentPeriodEnd: null }]) {
    assert.equal(isRunningPaidPeriod({ ...base, ...other }, NOW), false, JSON.stringify(other));
  }
  assert.equal(isRunningPaidPeriod(null, NOW), false);
});

test('month-end maths: 31 January plus a month is the last day of February, in an extension and at a confirm', async () => {
  sub(REFERRER, { currentPeriodEnd: new Date('2027-01-31T10:00:00.000Z') });
  referral();
  await confirm(payment(REFERRED));
  assert.equal(subOf(REFERRER).currentPeriodEnd.toISOString(), '2027-02-28T10:00:00.000Z');

  // A confirm on 31 December buys until 31 January; the held month then ends on the last day of February.
  subs = [];
  credits.push({ _id: oid(), seller: REFERRED_2, months: 1, referral: oid(), usedAt: null, usedByPayment: null });
  await confirm(payment(REFERRED_2), new Date('2026-12-31T10:00:00.000Z'));
  assert.equal(subOf(REFERRED_2).currentPeriodEnd.toISOString(), '2027-02-28T10:00:00.000Z');
});

test('a failed subscription write releases the months and rewards nothing', async () => {
  sub(REFERRED, { currentPeriodEnd: at(3) });
  const row = referral();
  credits.push({ _id: oid(), seller: REFERRED, months: 2, referral: oid(), usedAt: null, usedByPayment: null });
  failSubscriptionWrite = true;
  const own = payment(REFERRED);
  await assert.rejects(() => confirm(own));
  assert.equal(own.status, 'claimed');
  assert.equal(credits[0]!.usedAt, null);
  assert.equal(row.status, 'pending');
});

test('voiding the payment after the reward takes nothing back: the row is marked and audited for the owner, and a new confirm rewards nothing more', async () => {
  sub(REFERRER);
  const row = referral();
  const first = payment(REFERRED);
  await confirm(first);
  const end = subOf(REFERRER).currentPeriodEnd.getTime();

  await voided(first);
  assert.equal(row.status, 'rewarded');
  assert.equal(row.paymentVoidedAt.getTime(), NOW.getTime());
  assert.equal(subOf(REFERRER).currentPeriodEnd.getTime(), end);
  assert.ok(credits[0]!.usedAt);
  const note = audits.find((entry) => entry.action === 'referral.payment_voided_after_reward');
  assert.ok(note);
  assert.match(JSON.stringify(note), /NOT taken back/);

  await confirm(payment(REFERRED));
  assert.equal(credits.length, 1);
  assert.equal(subOf(REFERRER).currentPeriodEnd.getTime(), end);
});

test('voiding a payment that used held months gives them back', async () => {
  credits.push({ _id: oid(), seller: REFERRER, months: 1, referral: oid(), usedAt: null, usedByPayment: null });
  const own = payment(REFERRER);
  await confirm(own);
  assert.ok(credits[0]!.usedAt);
  await voided(own);
  assert.equal(credits[0]!.usedAt, null);
  assert.equal(credits[0]!.usedByPayment, null);
});

test('the two referral emails go to the referrer once per referral, with a masked name and never the referred email', async () => {
  const saved = process.env.APP_BASE_URL_SELLER;
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.test';
  stores.push({ _id: '65a000000000000000000011', owner: REFERRER });
  try {
    for (let i = 0; i < 2; i += 1) {
      await sendReferralSignedUp({ referralId: 'r1', referrer: REFERRER, referredName: 'B*** A.' });
      await sendReferralRewarded({ referralId: 'r1', referrer: REFERRER, months: 1, extension: null });
    }
    assert.deepEqual(outbox.map((row) => [row.template, row.to, row.dedupeKey]), [
      ['referral_signed_up', 'sana@example.com', 'referral_signed_up:r1'],
      ['referral_rewarded', 'sana@example.com', 'referral_rewarded:r1'],
    ]);
    assert.ok(outbox[0]!.bodyText.includes('B*** A.'));
    assert.ok(outbox[1]!.bodyText.includes('next confirmed plan payment'));
    assert.doesNotMatch(JSON.stringify(outbox), /bilal@example\.com|Bilal Ahmed/);
    await sendReferralRewarded({ referralId: 'r2', referrer: REFERRER, months: 2, extension: { planKey: 'growth', months: 2, periodEnd: new Date('2027-01-20T00:00:00.000Z') } });
    assert.ok(outbox[2]!.bodyText.includes('Your Growth plan now runs until 20 January 2027.'));
  } finally {
    if (saved === undefined) delete process.env.APP_BASE_URL_SELLER;
    else process.env.APP_BASE_URL_SELLER = saved;
  }
});
