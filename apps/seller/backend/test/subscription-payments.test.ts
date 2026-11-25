import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { ApiKey, AuditLog, PlatformSettingsModel, Product, Referral, Store, StoreMember, Subscription, SubscriptionCredit, SubscriptionPayment, SubscriptionPlanModel, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { useMemoryAuthLimits } from '@/lib/account-support';
import { setSessionUserLoader } from '@/lib/session-user';
import {
  adminPaymentListSchema,
  ownPaymentSchema,
  ownSubscriptionResponseSchema,
  paymentInstructionsSchema,
} from '../../../../packages/contracts/src/subscription-payments';
import { resolveEffectivePlan, setPlanLoader, type PlanDoc } from '../src/lib/plan';
import { claimPayment, requestUpgrade } from '../src/lib/subscription-payments';
import { confirmPayment, rejectPayment, voidPayment } from '../src/lib/subscription-payment-admin';
import { addMonthsUtc } from '../src/lib/subscription-period';

// Sprint 6 EP-14 (S6-B4, D-118): manual subscription payments, downgrade and cancel, on the seller backend: the seller's routes and the signed
// calls of the admin console. The models are stubbed in memory (with the compare-and-set and the unique open-payment index emulated); the real
// plan resolver runs through setPlanLoader. No database.

const AUTH_SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
const A = '65a000000000000000000001';
const B = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const STORE_A2 = '65a000000000000000000013';
const NOW = new Date('2026-11-20T10:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);

const limits = (stores: number | null, products: number | null, staffSeats: number | null, apiKeys: number | null) => ({ stores, products, staffSeats, apiKeys, customDomain: false, premiumThemes: false });
const FREE = { key: 'free', name: 'Free', priceRs: 0, isActive: true, limits: limits(1, 10, 0, 0) };
const STARTER = { key: 'starter', name: 'Starter', priceRs: 900, isActive: true, limits: limits(2, 100, 1, 1) };
const GROWTH = { key: 'growth', name: 'Growth', priceRs: 2500, isActive: true, limits: limits(3, null, 3, 3) };
const PRO = { key: 'pro', name: 'Pro', priceRs: 6000, isActive: true, limits: limits(null, null, null, null) };

type Row = Record<string, any>;

const PaymentModel = SubscriptionPayment as any;
const SubModel = Subscription as any;
const PlanModel = SubscriptionPlanModel as any;
const UserModel = User as any;
const StoreModel = Store as any;
const ProductModel = Product as any;
const MemberModel = StoreMember as any;
const ApiKeyModel = ApiKey as any;
const SettingsModel = PlatformSettingsModel as any;
const AuditModel = AuditLog as any;

let payments: Row[];
let subs: Row[];
let plans: Row[];
let users: Record<string, Row>;
let storeRows: Array<{ _id: string; owner: string }>;
let productCounts: Record<string, number>;
/** Seats held and live keys, by store id (S8-B4). */
let seatCounts: Record<string, number>;
let keyCounts: Record<string, number>;
let settingsDoc: Row | null;
let audits: Row[];
let seq = 0;
let clock = 0;
let failSubscriptionUpdate = false;
let failSubscriptionCreate = false;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let restore: () => void = () => {};

let subscriptionGET: (r: NextRequest) => Promise<Response>;
let instructionsGET: (r: NextRequest) => Promise<Response>;
let paymentsPOST: (r: NextRequest) => Promise<Response>;
let claimPOST: (r: NextRequest) => Promise<Response>;
let downgradePOST: (r: NextRequest) => Promise<Response>;
let cancelPOST: (r: NextRequest) => Promise<Response>;
let internalListGET: (r: NextRequest) => Promise<Response>;
let confirmPOST: (r: NextRequest) => Promise<Response>;
let rejectPOST: (r: NextRequest) => Promise<Response>;
let voidPOST: (r: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: A, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: B, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, AUTH_SECRET, SELLER_AUDIENCE);
  subscriptionGET = (await import('../src/app/api/subscription/route')).GET;
  instructionsGET = (await import('../src/app/api/subscription/instructions/route')).GET;
  paymentsPOST = (await import('../src/app/api/subscription/payments/route')).POST;
  claimPOST = (await import('../src/app/api/subscription/payments/claim/route')).POST;
  downgradePOST = (await import('../src/app/api/subscription/downgrade/route')).POST;
  cancelPOST = (await import('../src/app/api/subscription/cancel/route')).POST;
  internalListGET = (await import('../src/app/api/internal/subscription-payments/route')).GET;
  confirmPOST = (await import('../src/app/api/internal/subscription-payments/confirm/route')).POST;
  rejectPOST = (await import('../src/app/api/internal/subscription-payments/reject/route')).POST;
  voidPOST = (await import('../src/app/api/internal/subscription-payments/void/route')).POST;
});

// ------------------------------------------------------------------------------------------------------------------ the in-memory world

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};

const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

const matchValue = (actual: unknown, expected: any): boolean => {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date) && '$in' in expected) {
    return (expected.$in as unknown[]).some((candidate) => (candidate === null || candidate === undefined ? actual === null || actual === undefined : String(actual) === String(candidate)));
  }
  if (expected === null) return actual === null || actual === undefined;
  return String(actual) === String(expected);
};
const matches = (row: Row, filter: Row): boolean => Object.entries(filter).every(([key, value]) => matchValue(row[key], value));

/** Emulates findOneAndUpdate: the first row that matches the filter gets $set and $inc, and a copy comes back. null when nothing matches. */
function update(rows: Row[], filter: Row, change: Row, uniqueOpen: boolean): Row | null {
  const row = rows.find((candidate) => matches(candidate, filter));
  if (!row) return null;
  if (uniqueOpen && change.$set?.isOpen === true && rows.some((other) => other !== row && other.seller === row.seller && other.isOpen === true)) throw dup();
  Object.assign(row, change.$set ?? {});
  row.revision = (row.revision ?? 0) + (change.$inc?.revision ?? 0);
  return { ...row };
}

function payment(overrides: Row = {}): Row {
  seq += 1;
  return {
    _id: '65a0000000000000000e' + String(seq).padStart(4, '0'),
    seller: A,
    planKey: 'growth',
    amountRs: 2500,
    status: 'requested',
    isOpen: true,
    method: null,
    reference: null,
    proofUrl: null,
    periodStart: null,
    periodEnd: null,
    decidedBy: null,
    decidedAt: null,
    reason: null,
    claimedAt: null,
    subscriptionBefore: null,
    subscriptionRevisionAfter: null,
    revision: 0,
    createdAt: new Date(NOW.getTime() + ++clock * 1000),
    ...overrides,
  };
}

const claimed = (overrides: Row = {}): Row => payment({ status: 'claimed', method: 'jazzcash', reference: 'TX-1001', claimedAt: at(-1), ...overrides });

function sub(overrides: Row = {}): Row {
  return { _id: '65a0000000000000000f0001', seller: A, planKey: 'growth', status: 'active', periodStart: at(-10), currentPeriodEnd: at(20), graceUntil: null, trialEndsAt: null, source: 'manual', cancelAtPeriodEnd: false, pendingPlanKey: null, revision: 0, ...overrides };
}

beforeEach(() => {
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  payments = [];
  subs = [];
  plans = [FREE, STARTER, GROWTH, PRO].map((plan) => ({ ...plan }));
  users = { [A]: { _id: A, name: 'Ayesha Khan', email: 'ayesha@example.com' }, [B]: { _id: B, name: 'Bilal Raza', email: 'bilal@example.com' } };
  storeRows = [{ _id: STORE_A, owner: A }];
  productCounts = { [STORE_A]: 4, [STORE_A2]: 2 };
  seatCounts = {};
  keyCounts = {};
  settingsDoc = { paymentInstructions: 'Pay to Markazify, IBAN PK00 TEST 0000 0000.', graceDays: 7, trialDays: 0, supportEmail: 'billing@markazify.test', supportPhone: '+92 300 0000000' };
  audits = [];
  failSubscriptionUpdate = false;
  failSubscriptionCreate = false;
  useMemoryAuthLimits();
  setSessionUserLoader(async (id) => ({ role: id === ADMIN ? 'admin' : 'seller', accountStatus: 'active', tokenVersion: 0, emailVerified: true, emailVerifiedAt: new Date() }) as any);
  setPlanLoader(async (ownerId) =>
    resolveEffectivePlan({
      subscription: subs.find((candidate) => String(candidate.seller) === ownerId) ?? null,
      plans: { free: FREE as PlanDoc, starter: STARTER as PlanDoc, growth: GROWTH as PlanDoc, pro: PRO as PlanDoc },
      now: NOW,
      graceDays: 7,
    }),
  );

  const saved = {
    connect: (mongoose as any).connect,
    payment: Object.fromEntries(['find', 'findOne', 'findOneAndUpdate', 'create', 'countDocuments'].map((name) => [name, PaymentModel[name]])),
    sub: Object.fromEntries(['findOne', 'findOneAndUpdate', 'create'].map((name) => [name, SubModel[name]])),
    plan: { findOne: PlanModel.findOne, find: PlanModel.find },
    user: { findById: UserModel.findById, find: UserModel.find },
    store: { find: StoreModel.find, findOne: StoreModel.findOne },
    productAggregate: ProductModel.aggregate,
    memberAggregate: MemberModel.aggregate,
    keyAggregate: ApiKeyModel.aggregate,
    settings: SettingsModel.findOne,
    audit: AuditModel.create,
    referral: (Referral as any).findOne,
    credit: { find: (SubscriptionCredit as any).find, updateMany: (SubscriptionCredit as any).updateMany },
  };
  (mongoose as any).connect = async () => mongoose;
  // S8-B6: nobody here was referred and nobody holds referral months (test/referral-reward.test.ts covers both).
  (Referral as any).findOne = () => chain(() => null);
  (SubscriptionCredit as any).find = () => chain(() => []);
  (SubscriptionCredit as any).updateMany = async () => ({ modifiedCount: 0 });

  // lean() gives a copy, as the real driver does: a later write must not change what an earlier read holds.
  const copyOf = (row: Row | undefined): Row | null => (row ? { ...row } : null);
  PaymentModel.findOne = (filter: Row) => chain(() => copyOf(payments.find((row) => matches(row, filter))));
  PaymentModel.find = (filter: Row) => {
    let list = payments.filter((row) => matches(row, filter));
    const q: any = {
      select: () => q,
      sort: () => {
        list = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return q;
      },
      skip: (count: number) => {
        list = list.slice(count);
        return q;
      },
      limit: (count: number) => {
        list = list.slice(0, count);
        return q;
      },
      lean: async () => list.map((row) => ({ ...row })),
    };
    return q;
  };
  PaymentModel.countDocuments = async (filter: Row) => payments.filter((row) => matches(row, filter)).length;
  PaymentModel.findOneAndUpdate = (filter: Row, change: Row) => chain(() => update(payments, filter, change, true));
  PaymentModel.create = async (doc: Row) => {
    if (payments.some((row) => row.seller === String(doc.seller) && row.isOpen === true)) throw dup();
    const row = payment({ ...doc, seller: String(doc.seller) });
    payments.push(row);
    return { ...row };
  };

  SubModel.findOne = (filter: Row) => chain(() => copyOf(subs.find((row) => matches(row, filter))));
  SubModel.findOneAndUpdate = (filter: Row, change: Row) =>
    chain(() => {
      if (failSubscriptionUpdate) return null;
      return update(subs, filter, change, false);
    });
  SubModel.create = async (doc: Row) => {
    if (failSubscriptionCreate || subs.some((row) => String(row.seller) === String(doc.seller))) throw dup();
    const row = sub({ ...doc, _id: '65a0000000000000000f1' + String(++seq).padStart(3, '0'), seller: String(doc.seller) });
    subs.push(row);
    return { ...row };
  };

  PlanModel.findOne = (filter: Row) => chain(() => plans.find((row) => row.key === filter.key) ?? null);
  PlanModel.find = (filter: Row) => chain(() => plans.filter((row) => filter.key.$in.includes(row.key)));
  UserModel.findById = (id: unknown) => chain(() => users[String(id)] ?? null);
  UserModel.find = (filter: Row) => chain(() => filter._id.$in.map((id: string) => users[id]).filter(Boolean));
  StoreModel.find = (filter: Row) => chain(() => storeRows.filter((row) => row.owner === String(filter.owner)));
  StoreModel.findOne = (filter: Row) => chain(() => storeRows.find((row) => row.owner === String(filter.owner)) ?? null);
  const groupedFrom = (counts: () => Record<string, number>) => async (pipeline: any[]) =>
    pipeline[0].$match.store.$in.map(String).flatMap((id: string) => (counts()[id] ? [{ _id: id, n: counts()[id] }] : []));
  MemberModel.aggregate = groupedFrom(() => seatCounts);
  ApiKeyModel.aggregate = groupedFrom(() => keyCounts);
  ProductModel.aggregate = async (pipeline: any[]) => {
    const ids: string[] = pipeline[0].$match.store.$in.map(String);
    return ids.map((id) => ({ _id: id, n: productCounts[id] ?? 0 })).filter((row) => row.n > 0);
  };
  SettingsModel.findOne = () => chain(() => settingsDoc);
  AuditModel.create = async (doc: Row) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };

  restore = () => {
    (mongoose as any).connect = saved.connect;
    for (const [name, fn] of Object.entries(saved.payment)) PaymentModel[name] = fn;
    for (const [name, fn] of Object.entries(saved.sub)) SubModel[name] = fn;
    PlanModel.findOne = saved.plan.findOne;
    PlanModel.find = saved.plan.find;
    UserModel.findById = saved.user.findById;
    UserModel.find = saved.user.find;
    StoreModel.find = saved.store.find;
    StoreModel.findOne = saved.store.findOne;
    ProductModel.aggregate = saved.productAggregate;
    MemberModel.aggregate = saved.memberAggregate;
    ApiKeyModel.aggregate = saved.keyAggregate;
    SettingsModel.findOne = saved.settings;
    AuditModel.create = saved.audit;
    (Referral as any).findOne = saved.referral;
    Object.assign(SubscriptionCredit as any, saved.credit);
    setPlanLoader(null);
    setSessionUserLoader(null);
    delete process.env.MODERATION_API_SECRET;
  };
});

afterEach(() => restore());

// ---------------------------------------------------------------------------------------------------------------------------- requests

const sellerReq = (method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): NextRequest =>
  new NextRequest('http://seller.test' + path, {
    method,
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const signed = (method: 'GET' | 'POST', path: string, body?: unknown, secret: string = MOD_SECRET): NextRequest => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return new NextRequest('http://seller.test' + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...internalRequestHeaders(secret, { method, path, adminId: ADMIN, body: raw }) },
    ...(body === undefined ? {} : { body: raw }),
  });
};

const json = async (res: Response): Promise<any> => res.json();
const errorOf = async (res: Response): Promise<{ status: number; code: string | undefined; field: string | undefined; message: string }> => {
  const body = await json(res);
  return { status: res.status, code: body.code, field: body.field, message: body.errors?.[0]?.message ?? '' };
};

// =====================================================================================================================================
// GET /api/subscription and /instructions

test('the subscription page: 401 without a session, 403 for an admin session, and the seller reads only their own payments', async () => {
  assert.equal((await subscriptionGET(sellerReq('GET', '/api/subscription', null))).status, 401);
  assert.equal((await subscriptionGET(sellerReq('GET', '/api/subscription', tokenAdmin))).status, 403);
  subs = [sub()];
  payments = [claimed({ seller: A }), claimed({ seller: B, planKey: 'pro', amountRs: 6000, isOpen: false, status: 'confirmed' })];
  const res = await subscriptionGET(sellerReq('GET', '/api/subscription', tokenA));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await json(res);
  assert.equal(ownSubscriptionResponseSchema.safeParse(body).success, true);
  assert.equal(body.payments.length, 1);
  assert.equal(body.open.status, 'claimed');
  assert.equal(body.subscription.planKey, 'growth');
  assert.equal('seller' in body.payments[0], false, 'no seller id, no admin, no revision on the wire');
  assert.equal('revision' in body.payments[0], false);
  assert.equal('decidedBy' in body.payments[0], false);
  const other = await json(await subscriptionGET(sellerReq('GET', '/api/subscription', tokenB)));
  assert.deepEqual([other.subscription, other.payments.length], [null, 1]);
});

test('a seller with no subscription and no payment reads empty, not an error', async () => {
  const body = await json(await subscriptionGET(sellerReq('GET', '/api/subscription', tokenA)));
  assert.deepEqual(body, { subscription: null, open: null, payments: [] });
});

test('the payment instructions come from the platform settings as plain text; markup in them stays text (the portal escapes it)', async () => {
  settingsDoc = { ...settingsDoc, paymentInstructions: 'Send to <b>IBAN</b> PK00 & <script>alert(1)</script>', supportEmail: 'billing@markazify.test' };
  const res = await instructionsGET(sellerReq('GET', '/api/subscription/instructions', tokenA));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type')?.includes('application/json'), true, 'JSON, not an HTML page');
  const body = await json(res);
  assert.equal(paymentInstructionsSchema.safeParse(body).success, true);
  assert.deepEqual(body, { paymentInstructions: 'Send to <b>IBAN</b> PK00 & <script>alert(1)</script>', supportEmail: 'billing@markazify.test', supportPhone: '+92 300 0000000' });
});

test('instructions: null when the admin set none; 401 and 403 as everywhere', async () => {
  settingsDoc = {};
  assert.deepEqual(await json(await instructionsGET(sellerReq('GET', '/api/subscription/instructions', tokenA))), { paymentInstructions: null, supportEmail: null, supportPhone: null });
  assert.equal((await instructionsGET(sellerReq('GET', '/api/subscription/instructions', null))).status, 401);
  assert.equal((await instructionsGET(sellerReq('GET', '/api/subscription/instructions', tokenAdmin))).status, 403);
});

// =====================================================================================================================================
// POST /api/subscription/payments (the upgrade request)

test('an upgrade request writes a requested payment at the plan\'s price, for the signed-in seller, and audits it', async () => {
  const res = await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }));
  assert.equal(res.status, 201);
  const { payment: created } = await json(res);
  assert.equal(ownPaymentSchema.safeParse(created).success, true);
  assert.deepEqual([created.planKey, created.amountRs, created.status, created.method, created.reference], ['growth', 2500, 'requested', null, null]);
  assert.equal(payments.length, 1);
  assert.deepEqual([payments[0]!.seller, payments[0]!.isOpen], [A, true]);
  assert.deepEqual(audits.map((a) => [a.action, a.entity, a.actorId]), [['subscription_payment.request', 'subscriptionPayment', 'seller:' + A]]);
  assert.deepEqual([audits[0]!.details.planKey, audits[0]!.details.amountRs], ['growth', 2500]);
});

test('amount tampering is refused: a body that carries an amount, a price, a status or a seller is a 400 naming the field, and nothing is written', async () => {
  for (const extra of [{ amountRs: 1 }, { priceRs: 1 }, { status: 'confirmed' }, { seller: B }]) {
    const res = await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth', ...extra }));
    const err = await errorOf(res);
    assert.deepEqual([err.status, err.field], [400, Object.keys(extra)[0]], JSON.stringify(extra));
  }
  assert.equal(payments.length, 0);
});

test('the amount is the plan\'s price when asked, and a later price change does not touch an earlier request', async () => {
  await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'pro' }));
  assert.equal(payments[0]!.amountRs, 6000);
  plans.find((plan) => plan.key === 'pro')!.priceRs = 7000;
  assert.equal(payments[0]!.amountRs, 6000);
});

test('a bad or missing plan key is a 400 with the field; an unknown plan is a 404; an archived one too', async () => {
  assert.deepEqual((await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'Not A Key' })))).field, 'planKey');
  assert.equal((await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, {})))).status, 400);
  assert.equal((await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, 'not json')))).status, 400);
  const unknown = await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'gold' })));
  assert.deepEqual([unknown.status, unknown.code], [404, 'PLAN_NOT_FOUND']);
  plans.find((plan) => plan.key === 'pro')!.isActive = false;
  assert.equal((await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'pro' })))).status, 404);
  assert.equal(payments.length, 0);
});

test('a free plan (price 0) cannot be requested: 422 PLAN_IS_FREE', async () => {
  const err = await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'free' })));
  assert.deepEqual([err.status, err.code, err.field], [422, 'PLAN_IS_FREE', 'planKey']);
  assert.equal(payments.length, 0);
});

test('401 without a session and 403 for an admin session; neither writes', async () => {
  assert.equal((await paymentsPOST(sellerReq('POST', '/api/subscription/payments', null, { planKey: 'growth' }))).status, 401);
  assert.equal((await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenAdmin, { planKey: 'growth' }))).status, 403);
  assert.equal(payments.length, 0);
});

test('only one open payment per seller: the same unclaimed request again is the same payment (a double click), nothing new is written', async () => {
  const first = await json(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' })));
  const again = await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }));
  assert.equal(again.status, 200);
  assert.equal((await json(again)).payment.id, first.payment.id);
  assert.equal(payments.length, 1);
});

test('an unclaimed request for another plan replaces the old one (it becomes void); a claimed one blocks with 409 PAYMENT_OPEN', async () => {
  await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'starter' }));
  const second = await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }));
  assert.equal(second.status, 201);
  assert.deepEqual(payments.map((row) => [row.planKey, row.status, row.isOpen]), [['starter', 'void', false], ['growth', 'requested', true]]);
  assert.equal(payments[0]!.reason, 'Replaced by a new request');

  payments[1]!.status = 'claimed';
  const blocked = await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'pro' })));
  assert.deepEqual([blocked.status, blocked.code], [409, 'PAYMENT_OPEN']);
  assert.equal(payments.length, 2);
});

test('another seller\'s open payment does not block this one', async () => {
  payments = [claimed({ seller: B })];
  const res = await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }));
  assert.equal(res.status, 201);
  assert.equal(payments.length, 2);
});

test('a lost race on the unique open-payment index is the same 409, not a 500', async () => {
  const original = PaymentModel.create;
  PaymentModel.create = async () => {
    throw dup();
  };
  try {
    const err = await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' })));
    assert.deepEqual([err.status, err.code], [409, 'PAYMENT_OPEN']);
  } finally {
    PaymentModel.create = original;
  }
});

test('a cheaper plan than the one in force goes through Downgrade (422 USE_DOWNGRADE); a dearer one and the same plan are fine', async () => {
  subs = [sub()];
  const err = await errorOf(await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'starter' })));
  assert.deepEqual([err.status, err.code], [422, 'USE_DOWNGRADE']);
  assert.equal((await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'pro' }))).status, 201);
  payments = [];
  assert.equal((await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }))).status, 201, 'a renewal');
});

test('the limiter allows 10 requests an hour per seller and then answers 429 with Retry-After; another seller is not affected', async () => {
  for (let i = 0; i < 10; i += 1) {
    const res = await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }));
    assert.equal(res.status === 200 || res.status === 201, true, 'request ' + (i + 1));
  }
  const limited = await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal((await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenB, { planKey: 'growth' }))).status, 201);
});

// =====================================================================================================================================
// POST /api/subscription/payments/claim ("I paid")

const claimBody = (paymentId: string, extra: Row = {}) => ({ paymentId, method: 'jazzcash', reference: 'TX-77812', ...extra });

test('I paid: requested becomes claimed with the method, the reference and the proof link; the audit line says so', async () => {
  payments = [payment()];
  const res = await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(payments[0]!._id, { proofUrl: 'https://example.com/slip.jpg' })));
  assert.equal(res.status, 200);
  const { payment: out } = await json(res);
  assert.equal(ownPaymentSchema.safeParse(out).success, true);
  assert.deepEqual([out.status, out.method, out.reference, out.proofUrl], ['claimed', 'jazzcash', 'TX-77812', 'https://example.com/slip.jpg']);
  assert.notEqual(out.claimedAt, null);
  assert.deepEqual([payments[0]!.status, payments[0]!.isOpen, payments[0]!.revision], ['claimed', true, 1]);
  assert.deepEqual(audits.map((a) => a.action), ['subscription_payment.claim']);
  assert.deepEqual([audits[0]!.details.method, audits[0]!.details.reference], ['jazzcash', 'TX-77812']);
});

test('I paid without a proof link stores null', async () => {
  payments = [payment()];
  await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(payments[0]!._id)));
  assert.equal(payments[0]!.proofUrl, null);
});

test('Seller B can neither see nor claim Seller A\'s payment: the same 404 as an unknown id, and A\'s payment is untouched', async () => {
  payments = [payment()];
  const foreign = await errorOf(await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenB, claimBody(payments[0]!._id))));
  assert.equal(foreign.status, 404);
  const unknown = await errorOf(await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenB, claimBody('65a0000000000000000eaaaa'))));
  assert.deepEqual([unknown.status, unknown.message], [404, foreign.message]);
  assert.deepEqual([payments[0]!.status, payments[0]!.revision], ['requested', 0]);
  assert.equal(audits.length, 0);
  const list = await json(await subscriptionGET(sellerReq('GET', '/api/subscription', tokenB)));
  assert.deepEqual(list.payments, []);
});

test('the claim body cannot carry an amount, a status or a decision: a 400 naming the field', async () => {
  payments = [payment()];
  for (const extra of [{ amountRs: 1 }, { status: 'confirmed' }, { decidedBy: 'x' }, { periodEnd: '2030-01-01T00:00:00Z' }]) {
    const err = await errorOf(await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(payments[0]!._id, extra))));
    assert.deepEqual([err.status, err.field], [400, Object.keys(extra)[0]], JSON.stringify(extra));
  }
  assert.equal(payments[0]!.status, 'requested');
});

test('the claim is checked field by field: method, reference, proof link and payment id', async () => {
  payments = [payment()];
  const id = payments[0]!._id;
  const cases: Array<[Row, string]> = [
    [{ method: 'cash' }, 'method'],
    [{ reference: '' }, 'reference'],
    [{ reference: 'x'.repeat(101) }, 'reference'],
    [{ reference: '<b>1</b>' }, 'reference'],
    [{ proofUrl: 'http://example.com/a.jpg' }, 'proofUrl'],
    [{ proofUrl: 'javascript:alert(1)' }, 'proofUrl'],
    [{ proofUrl: 'https://' + 'x'.repeat(300) }, 'proofUrl'],
    [{ paymentId: 'nope' }, 'paymentId'],
  ];
  for (const [extra, field] of cases) {
    const err = await errorOf(await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, { ...claimBody(id), ...extra })));
    assert.deepEqual([err.status, err.field], [400, field], JSON.stringify(extra).slice(0, 50));
  }
  assert.equal(payments[0]!.status, 'requested');
});

test('claiming twice, or claiming a decided payment, is a 409 and changes nothing', async () => {
  payments = [payment()];
  const id = payments[0]!._id;
  assert.equal((await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(id)))).status, 200);
  const twice = await errorOf(await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(id, { reference: 'OTHER' }))));
  assert.deepEqual([twice.status, twice.code], [409, 'PAYMENT_NOT_REQUESTED']);
  assert.equal(payments[0]!.reference, 'TX-77812', 'the first claim stands');

  payments = [payment({ status: 'confirmed', isOpen: false })];
  assert.equal((await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(payments[0]!._id)))).status, 409);
});

test('the claim is ONE compare-and-set: when the payment moved between the read and the write, nothing is overwritten (409)', async () => {
  payments = [payment()];
  const original = PaymentModel.findOneAndUpdate;
  PaymentModel.findOneAndUpdate = (filter: Row, change: Row) => {
    payments[0]!.status = 'rejected';
    payments[0]!.isOpen = false;
    return original(filter, change);
  };
  try {
    const err = await errorOf(await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(payments[0]!._id))));
    assert.deepEqual([err.status, err.code], [409, 'PAYMENT_NOT_REQUESTED']);
    assert.equal(payments[0]!.status, 'rejected');
  } finally {
    PaymentModel.findOneAndUpdate = original;
  }
});

test('the claim limiter: 10 an hour per seller, then 429', async () => {
  payments = [payment()];
  const id = payments[0]!._id;
  for (let i = 0; i < 10; i += 1) await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(id)));
  assert.equal((await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenA, claimBody(id)))).status, 429);
});

test('claim: 401 without a session and 403 for an admin session', async () => {
  payments = [payment()];
  assert.equal((await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', null, claimBody(payments[0]!._id)))).status, 401);
  assert.equal((await claimPOST(sellerReq('POST', '/api/subscription/payments/claim', tokenAdmin, claimBody(payments[0]!._id)))).status, 403);
});

// =====================================================================================================================================
// Downgrade

test('a downgrade that fits is stored as pending and takes effect at the period end: the plan in force does not change now', async () => {
  subs = [sub()];
  const res = await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'starter' }));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(ownSubscriptionResponseSchema.safeParse(body).success, true);
  assert.deepEqual([body.subscription.pendingPlanKey, body.subscription.planKey, body.subscription.status], ['starter', 'growth', 'active']);
  assert.deepEqual([subs[0]!.pendingPlanKey, subs[0]!.planKey, subs[0]!.revision], ['starter', 'growth', 1]);
  assert.deepEqual(audits.map((a) => a.action), ['subscription.downgrade_scheduled']);
  const effective = await (await import('../src/lib/plan')).loadEffectivePlan(A, NOW);
  assert.deepEqual([effective.key, effective.status], ['growth', 'active']);
});

test('a downgrade that does not fit is a 422 listing what exceeds, per limit', async () => {
  subs = [sub()];
  storeRows = [{ _id: STORE_A, owner: A }, { _id: STORE_A2, owner: A }, { _id: '65a000000000000000000014', owner: A }];
  productCounts = { [STORE_A]: 120, [STORE_A2]: 5 };
  const res = await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'starter' }));
  assert.equal(res.status, 422);
  const body = await json(res);
  assert.equal(body.code, 'DOWNGRADE_EXCEEDS_LIMITS');
  assert.deepEqual(body.exceeds, [{ limit: 'stores', allowed: 2, used: 3 }, { limit: 'products', allowed: 100, used: 120 }]);
  assert.match(body.errors[0].message, /stores: the Starter plan allows 2 and you have 3/);
  assert.equal(subs[0]!.pendingPlanKey, null);
  assert.equal(audits.length, 0);
});

test('a downgrade that would leave too many team seats or API keys in a store is refused, counting the busiest store of each (S8-B4)', async () => {
  subs = [sub()];
  storeRows = [{ _id: STORE_A, owner: A }, { _id: STORE_A2, owner: A }];
  seatCounts = { [STORE_A]: 3, [STORE_A2]: 1 };
  keyCounts = { [STORE_A2]: 2 };
  const res = await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'starter' }));
  assert.equal(res.status, 422);
  const body = await json(res);
  assert.equal(body.code, 'DOWNGRADE_EXCEEDS_LIMITS');
  assert.deepEqual(body.exceeds, [{ limit: 'staffSeats', allowed: 1, used: 3 }, { limit: 'apiKeys', allowed: 1, used: 2 }]);
  assert.match(body.errors[0].message, /staff seats in a store: the Starter plan allows 1 and you have 3/);
  assert.match(body.errors[0].message, /API keys in a store: the Starter plan allows 1 and you have 2/);
  assert.equal(subs[0]!.pendingPlanKey, null);

  // The limits are per store: one seat and one key in EACH store fit a plan that allows one.
  seatCounts = { [STORE_A]: 1, [STORE_A2]: 1 };
  keyCounts = { [STORE_A]: 1, [STORE_A2]: 1 };
  assert.equal((await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'starter' }))).status, 200);
  assert.equal(subs[0]!.pendingPlanKey, 'starter');
});

test('Free as the target: its own limits count (1 store, 10 products in a store)', async () => {
  subs = [sub()];
  storeRows = [{ _id: STORE_A, owner: A }, { _id: STORE_A2, owner: A }];
  productCounts = { [STORE_A]: 12, [STORE_A2]: 3 };
  const body = await json(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'free' })));
  assert.deepEqual(body.exceeds, [{ limit: 'stores', allowed: 1, used: 2 }, { limit: 'products', allowed: 10, used: 12 }]);
  storeRows = [{ _id: STORE_A, owner: A }];
  productCounts = { [STORE_A]: 10 };
  assert.equal((await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'free' }))).status, 200);
  assert.equal(subs[0]!.pendingPlanKey, 'free');
});

test('the seller\'s own store-limit override wins over the target plan\'s store limit', async () => {
  subs = [sub()];
  storeRows = [{ _id: STORE_A, owner: A }, { _id: STORE_A2, owner: A }];
  productCounts = {};
  users[A]!.storeLimitOverride = 5;
  assert.equal((await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'free' }))).status, 200);
});

test('a pending downgrade can be taken back with planKey null; taking back when none is pending writes nothing', async () => {
  subs = [sub({ pendingPlanKey: 'starter' })];
  const body = await json(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: null })));
  assert.equal(body.subscription.pendingPlanKey, null);
  assert.deepEqual(audits.map((a) => a.action), ['subscription.downgrade_cancelled']);
  const revision = subs[0]!.revision;
  await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: null }));
  assert.equal(subs[0]!.revision, revision);
});

test('not a downgrade: the plan you are on, and a dearer plan, are 422 NOT_A_DOWNGRADE; an unknown plan is 404', async () => {
  subs = [sub()];
  for (const planKey of ['growth', 'pro']) {
    const err = await errorOf(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey })));
    assert.deepEqual([err.status, err.code], [422, 'NOT_A_DOWNGRADE'], planKey);
  }
  assert.equal((await errorOf(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'gold' })))).status, 404);
  assert.equal(subs[0]!.pendingPlanKey, null);
});

test('a seller on the Free plan (no subscription) has nothing to downgrade: 409 NOTHING_TO_CHANGE', async () => {
  const err = await errorOf(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'free' })));
  assert.deepEqual([err.status, err.code], [409, 'NOTHING_TO_CHANGE']);
  subs = [sub({ status: 'expired', currentPeriodEnd: at(-40) })];
  assert.equal((await errorOf(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'free' })))).status, 409, 'expired means Free already');
});

test('a downgrade of the subscription that moved between the read and the write is a 409, not an overwrite', async () => {
  subs = [sub()];
  failSubscriptionUpdate = true;
  const err = await errorOf(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'starter' })));
  assert.deepEqual([err.status, err.code], [409, 'SUBSCRIPTION_CHANGED']);
  assert.equal(subs[0]!.pendingPlanKey, null);
});

test('downgrade: only the signed-in seller\'s own subscription is read or written; B has none', async () => {
  subs = [sub()];
  assert.equal((await errorOf(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenB, { planKey: 'starter' })))).status, 409);
  assert.equal(subs[0]!.pendingPlanKey, null);
  assert.equal((await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', null, { planKey: 'starter' }))).status, 401);
  assert.equal((await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenAdmin, { planKey: 'starter' }))).status, 403);
  assert.deepEqual((await errorOf(await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'starter', now: true })))).field, 'now');
});

// =====================================================================================================================================
// Cancel

test('cancel at the period end sets the flag, the plan stays in force, and the cancel can be taken back', async () => {
  subs = [sub()];
  const set = await json(await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: true })));
  assert.equal(ownSubscriptionResponseSchema.safeParse(set).success, true);
  assert.deepEqual([set.subscription.cancelAtPeriodEnd, set.subscription.status, set.subscription.planKey], [true, 'active', 'growth']);
  assert.equal(subs[0]!.cancelAtPeriodEnd, true);
  const effective = await (await import('../src/lib/plan')).loadEffectivePlan(A, NOW);
  assert.deepEqual([effective.key, effective.status], ['growth', 'active']);

  const unset = await json(await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: false })));
  assert.equal(unset.subscription.cancelAtPeriodEnd, false);
  assert.deepEqual(audits.map((a) => a.action), ['subscription.cancel_scheduled', 'subscription.cancel_withdrawn']);
});

test('setting the value it already has is a 200 and writes nothing', async () => {
  subs = [sub({ cancelAtPeriodEnd: true })];
  const res = await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: true }));
  assert.equal(res.status, 200);
  assert.deepEqual([subs[0]!.revision, audits.length], [0, 0]);
});

test('only a paid, running period can be cancelled: none, grace, expired and trial are 409', async () => {
  assert.equal((await errorOf(await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: true })))).code, 'NOTHING_TO_CHANGE');
  for (const status of ['grace', 'expired', 'trial']) {
    subs = [sub({ status, currentPeriodEnd: at(-2), graceUntil: at(3), trialEndsAt: at(3) })];
    const err = await errorOf(await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: true })));
    assert.equal(err.status, 409, status);
    assert.equal(subs[0]!.cancelAtPeriodEnd, false, status);
  }
});

test('cancel: the body must be a boolean (400 with the field); 401, 403; a moved subscription is a 409', async () => {
  subs = [sub()];
  assert.deepEqual((await errorOf(await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: 'yes' })))).field, 'cancelAtPeriodEnd');
  assert.equal((await cancelPOST(sellerReq('POST', '/api/subscription/cancel', null, { cancelAtPeriodEnd: true }))).status, 401);
  assert.equal((await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenAdmin, { cancelAtPeriodEnd: true }))).status, 403);
  failSubscriptionUpdate = true;
  assert.equal((await errorOf(await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: true })))).code, 'SUBSCRIPTION_CHANGED');
});

test('the downgrade and cancel limiter: 20 an hour per seller, then 429', async () => {
  subs = [sub()];
  for (let i = 0; i < 20; i += 1) await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: i % 2 === 0 }));
  assert.equal((await cancelPOST(sellerReq('POST', '/api/subscription/cancel', tokenA, { cancelAtPeriodEnd: true }))).status, 429);
  assert.equal((await downgradePOST(sellerReq('POST', '/api/subscription/downgrade', tokenA, { planKey: 'starter' }))).status, 429, 'the two routes share the allowance');
});

// =====================================================================================================================================
// The admin side: the signed internal routes (confirm, reject, void, list)

const CONFIRM = '/api/internal/subscription-payments/confirm';
const REJECT = '/api/internal/subscription-payments/reject';
const VOID = '/api/internal/subscription-payments/void';
const LIST = '/api/internal/subscription-payments';

test('the internal routes answer only a signed call: an unsigned one, a seller session, an admin session and a wrong secret are all 401', async () => {
  payments = [claimed()];
  const id = payments[0]!._id;
  const body = { paymentId: id, amountRs: 2500, reason: 'Slip checked' };
  const plain = (token: string | null) => sellerReq('POST', CONFIRM, token, body);
  assert.equal((await confirmPOST(plain(null))).status, 401);
  assert.equal((await confirmPOST(plain(tokenA))).status, 401, 'a seller can never confirm their own payment');
  assert.equal((await confirmPOST(plain(tokenAdmin))).status, 401, 'a session is not a signature');
  assert.equal((await confirmPOST(signed('POST', CONFIRM, body, 'w'.repeat(40)))).status, 401);
  assert.equal((await rejectPOST(sellerReq('POST', REJECT, tokenA, { paymentId: id, reason: 'not valid' }))).status, 401);
  assert.equal((await voidPOST(sellerReq('POST', VOID, tokenA, { paymentId: id, reason: 'not valid' }))).status, 401);
  assert.equal((await internalListGET(sellerReq('GET', LIST, tokenA))).status, 401);
  assert.deepEqual([payments[0]!.status, payments[0]!.revision], ['claimed', 0]);
  assert.equal(subs.length, 0);
  delete process.env.MODERATION_API_SECRET;
  assert.equal((await confirmPOST(signed('POST', CONFIRM, body))).status, 503, 'a missing secret closes the routes');
});

test('confirm creates the subscription for a seller who had none: active, the plan, a one month period, no grace, source manual', async () => {
  payments = [claimed()];
  const res = await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }));
  assert.equal(res.status, 200);
  const { payment: out } = await json(res);
  assert.deepEqual([out.status, out.decidedBy, out.reason, out.amountRs], ['confirmed', 'admin:' + ADMIN, 'Slip checked', 2500]);
  assert.deepEqual([out.seller.name, out.seller.email, out.planName], ['Ayesha Khan', 'ayesha@example.com', 'Growth']);
  assert.equal(subs.length, 1);
  const created = subs[0]!;
  assert.deepEqual([created.planKey, created.status, created.graceUntil, created.source, created.cancelAtPeriodEnd, created.pendingPlanKey, created.revision], ['growth', 'active', null, 'manual', false, null, 1]);
  assert.equal(created.currentPeriodEnd.getTime(), addMonthsUtc(created.periodStart, 1).getTime());
  assert.deepEqual([payments[0]!.status, payments[0]!.isOpen, payments[0]!.subscriptionBefore, payments[0]!.subscriptionRevisionAfter], ['confirmed', false, null, 1]);
  assert.equal(payments[0]!.periodEnd.getTime(), created.currentPeriodEnd.getTime());
});

test('the audit line of a confirm names the admin, the seller, the plan, the AMOUNT, the method, the reference, the reason and the period', async () => {
  payments = [claimed()];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }, ADMIN, NOW);
  const entry = audits.find((a) => a.action === 'subscription_payment.confirm')!;
  assert.deepEqual([entry.entity, entry.entityId, entry.actorId], ['subscriptionPayment', payments[0]!._id, 'admin:' + ADMIN]);
  assert.deepEqual(
    [entry.details.seller, entry.details.planKey, entry.details.amountRs, entry.details.method, entry.details.reference, entry.details.reason],
    [A, 'growth', 2500, 'jazzcash', 'TX-1001', 'Slip checked'],
  );
  assert.deepEqual([entry.details.periodStart, entry.details.periodEnd, entry.details.extended], [NOW.toISOString(), '2026-12-20T10:00:00.000Z', false]);
});

test('a renewal while still active extends from the current period end and clears a cancel, a pending downgrade and a stale grace', async () => {
  subs = [sub({ currentPeriodEnd: at(5), cancelAtPeriodEnd: true, pendingPlanKey: 'starter', graceUntil: at(9) })];
  payments = [claimed()];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Renewal paid' }, ADMIN, NOW);
  assert.equal(subs[0]!.periodStart.getTime(), at(5).getTime());
  assert.equal(subs[0]!.currentPeriodEnd.getTime(), addMonthsUtc(at(5), 1).getTime());
  assert.deepEqual([subs[0]!.status, subs[0]!.cancelAtPeriodEnd, subs[0]!.pendingPlanKey, subs[0]!.graceUntil, subs.length], ['active', false, null, null, 1]);
  assert.equal(audits.find((a) => a.action === 'subscription_payment.confirm')!.details.extended, true);
});

test('a payment after the period ended (grace or expired) starts a new period at the confirm date and clears the grace', async () => {
  for (const [status, end, grace] of [['grace', at(-3), at(4)], ['expired', at(-40), null]] as const) {
    subs = [sub({ status, currentPeriodEnd: end, graceUntil: grace })];
    payments = [claimed()];
    await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Paid late' }, ADMIN, NOW);
    assert.equal(subs[0]!.periodStart.getTime(), NOW.getTime(), status);
    assert.deepEqual([subs[0]!.status, subs[0]!.graceUntil], ['active', null], status);
    assert.equal(subs[0]!.currentPeriodEnd.getTime(), addMonthsUtc(NOW, 1).getTime(), status);
  }
});

test('an upgrade payment switches the plan (and starts at the confirm date: no days carried over)', async () => {
  subs = [sub({ planKey: 'starter', currentPeriodEnd: at(15) })];
  payments = [claimed({ planKey: 'growth' })];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Upgrade paid' }, ADMIN, NOW);
  assert.deepEqual([subs[0]!.planKey, subs[0]!.periodStart.getTime()], ['growth', NOW.getTime()]);
});

test('a DOUBLE confirm has exactly one effect: two at once leave one subscription write and one 409', async () => {
  payments = [claimed()];
  const input = { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' };
  const results = await Promise.allSettled([confirmPayment(input, ADMIN, NOW), confirmPayment(input, ADMIN, NOW)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(lost.reason.status, 409);
  assert.equal(subs.length, 1);
  assert.equal(subs[0]!.revision, 1, 'the subscription was written once');
  assert.equal(payments[0]!.revision, 1, 'the payment was decided once');
  assert.equal(audits.filter((a) => a.action === 'subscription_payment.confirm').length, 1);
});

test('a second confirm after the first is a 409 and the subscription is not extended again', async () => {
  payments = [claimed()];
  const first = await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }));
  assert.equal(first.status, 200);
  const end = subs[0]!.currentPeriodEnd.getTime();
  const second = await errorOf(await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' })));
  assert.deepEqual([second.status, second.code], [409, 'PAYMENT_NOT_CLAIMED']);
  assert.equal(subs[0]!.currentPeriodEnd.getTime(), end);
  assert.equal(subs[0]!.revision, 1);
});

test('confirming a rejected, a void or a not yet claimed payment is refused (409) and nothing changes', async () => {
  for (const status of ['rejected', 'void', 'requested']) {
    payments = [payment({ status, isOpen: status === 'requested' })];
    const err = await errorOf(await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' })));
    assert.deepEqual([err.status, err.code], [409, 'PAYMENT_NOT_CLAIMED'], status);
    assert.deepEqual([payments[0]!.status, payments[0]!.revision], [status, 0], status);
  }
  assert.equal(subs.length, 0);
});

test('confirm at a different amount than the payment\'s is a 409 PAYMENT_AMOUNT_MISMATCH: the screen was stale', async () => {
  payments = [claimed()];
  const err = await errorOf(await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 900, reason: 'Slip checked' })));
  assert.deepEqual([err.status, err.code], [409, 'PAYMENT_AMOUNT_MISMATCH']);
  assert.match(err.message, /Rs\. 2,500/);
  assert.deepEqual([payments[0]!.status, subs.length], ['claimed', 0]);
});

test('confirm needs a whole amount and a reason of 3 or more characters: 422 from the contract, nothing written', async () => {
  payments = [claimed()];
  const id = payments[0]!._id;
  for (const body of [{ paymentId: id, amountRs: 2500.5, reason: 'Slip checked' }, { paymentId: id, amountRs: 2500, reason: 'ok' }, { paymentId: id, amountRs: 2500 }, { paymentId: 'x', amountRs: 2500, reason: 'Slip checked' }, { paymentId: id, amountRs: 2500, reason: 'Slip checked', status: 'confirmed' }]) {
    assert.equal((await confirmPOST(signed('POST', CONFIRM, body))).status, 422, JSON.stringify(body));
  }
  assert.equal(payments[0]!.status, 'claimed');
});

test('an unknown payment id is a 404', async () => {
  assert.equal((await confirmPOST(signed('POST', CONFIRM, { paymentId: '65a0000000000000000eaaaa', amountRs: 2500, reason: 'Slip checked' }))).status, 404);
});

test('a plan that no longer exists: 409 PLAN_GONE and the payment stays claimed', async () => {
  payments = [claimed({ planKey: 'growth' })];
  plans = plans.filter((plan) => plan.key !== 'growth');
  const err = await errorOf(await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' })));
  assert.deepEqual([err.status, err.code], [409, 'PLAN_GONE']);
  assert.equal(payments[0]!.status, 'claimed');
});

test('if the subscription moved at the same instant, the payment is put back to claimed and the admin is told to try again (nothing half done)', async () => {
  subs = [sub({ currentPeriodEnd: at(5) })];
  payments = [claimed()];
  failSubscriptionUpdate = true;
  const err = await errorOf(await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' })));
  assert.deepEqual([err.status, err.code], [409, 'SUBSCRIPTION_CHANGED']);
  assert.deepEqual([payments[0]!.status, payments[0]!.isOpen, payments[0]!.decidedBy, payments[0]!.periodEnd, payments[0]!.reason], ['claimed', true, null, null, null]);
  assert.equal(subs[0]!.revision, 0);
  assert.equal(audits.filter((a) => a.action === 'subscription_payment.confirm').length, 0);
  failSubscriptionUpdate = false;
  assert.equal((await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }))).status, 200, 'and it can be confirmed afterwards');
});

test('a subscription created by someone else in the same instant (the unique index) also puts the payment back', async () => {
  payments = [claimed()];
  failSubscriptionCreate = true;
  const err = await errorOf(await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' })));
  assert.deepEqual([err.status, err.code], [409, 'SUBSCRIPTION_CHANGED']);
  assert.equal(payments[0]!.status, 'claimed');
});

test('a failing audit write does not undo a confirmed payment', async () => {
  payments = [claimed()];
  AuditModel.create = async () => {
    throw new Error('audit down');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await confirmPOST(signed('POST', CONFIRM, { paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }))).status, 200);
  } finally {
    console.error = quiet;
  }
  assert.equal(payments[0]!.status, 'confirmed');
});

test('reject: a claimed or requested payment is refused with a reason of 5 or more characters; the subscription is not touched; the seller may ask again', async () => {
  subs = [sub()];
  payments = [claimed()];
  const res = await rejectPOST(signed('POST', REJECT, { paymentId: payments[0]!._id, reason: 'Amount does not match' }));
  assert.equal(res.status, 200);
  assert.deepEqual([(await json(res)).payment.status, payments[0]!.isOpen, payments[0]!.reason, payments[0]!.decidedBy], ['rejected', false, 'Amount does not match', 'admin:' + ADMIN]);
  assert.equal(subs[0]!.revision, 0);
  assert.deepEqual(audits.map((a) => a.action), ['subscription_payment.reject']);
  assert.equal((await paymentsPOST(sellerReq('POST', '/api/subscription/payments', tokenA, { planKey: 'growth' }))).status, 201, 'the open slot is free again');

  payments = [payment()];
  assert.equal((await rejectPOST(signed('POST', REJECT, { paymentId: payments[0]!._id, reason: 'Never paid' }))).status, 200, 'an unclaimed request can be refused too');
});

test('reject: a short reason is 422; a confirmed, rejected or void payment is a 409; a rejected payment can then not be confirmed', async () => {
  payments = [claimed()];
  const id = payments[0]!._id;
  assert.equal((await rejectPOST(signed('POST', REJECT, { paymentId: id, reason: 'nope' }))).status, 422);
  assert.equal((await rejectPOST(signed('POST', REJECT, { paymentId: id, reason: 'Amount does not match' }))).status, 200);
  assert.equal((await errorOf(await rejectPOST(signed('POST', REJECT, { paymentId: id, reason: 'Amount does not match' })))).code, 'PAYMENT_NOT_OPEN');
  assert.equal((await confirmPOST(signed('POST', CONFIRM, { paymentId: id, amountRs: 2500, reason: 'Slip checked' }))).status, 409);
  payments = [payment({ status: 'confirmed', isOpen: false })];
  assert.equal((await rejectPOST(signed('POST', REJECT, { paymentId: payments[0]!._id, reason: 'Amount does not match' }))).status, 409);
});

test('reject loses cleanly to a decision made at the same instant (compare-and-set): 409 and no overwrite', async () => {
  payments = [claimed()];
  const original = PaymentModel.findOneAndUpdate;
  PaymentModel.findOneAndUpdate = (filter: Row, change: Row) => {
    payments[0]!.status = 'confirmed';
    payments[0]!.isOpen = false;
    return original(filter, change);
  };
  try {
    const err = await errorOf(await rejectPOST(signed('POST', REJECT, { paymentId: payments[0]!._id, reason: 'Amount does not match' })));
    assert.deepEqual([err.status, err.code], [409, 'PAYMENT_ALREADY_DECIDED']);
    assert.equal(payments[0]!.status, 'confirmed');
  } finally {
    PaymentModel.findOneAndUpdate = original;
  }
});

test('void: a claimed or requested payment is closed; a rejected one is a 409', async () => {
  payments = [claimed()];
  const res = await voidPOST(signed('POST', VOID, { paymentId: payments[0]!._id, reason: 'Seller asked to cancel' }));
  assert.equal(res.status, 200);
  assert.deepEqual([payments[0]!.status, payments[0]!.isOpen], ['void', false]);
  assert.equal((await errorOf(await voidPOST(signed('POST', VOID, { paymentId: payments[0]!._id, reason: 'Seller asked to cancel' })))).code, 'PAYMENT_NOT_VOIDABLE');
  payments = [payment({ status: 'rejected', isOpen: false })];
  assert.equal((await voidPOST(signed('POST', VOID, { paymentId: payments[0]!._id, reason: 'Seller asked to cancel' }))).status, 409);
  assert.equal((await voidPOST(signed('POST', VOID, { paymentId: payments[0]!._id, reason: 'no' }))).status, 422);
});

test('void of a CONFIRMED payment takes the subscription back to what it was, while nothing else changed it', async () => {
  subs = [sub({ planKey: 'starter', currentPeriodEnd: at(3) })];
  payments = [claimed({ planKey: 'growth' })];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }, ADMIN, NOW);
  assert.equal(subs[0]!.planKey, 'growth');
  const res = await voidPOST(signed('POST', VOID, { paymentId: payments[0]!._id, reason: 'Payment bounced' }));
  assert.equal(res.status, 200);
  assert.deepEqual([payments[0]!.status, payments[0]!.reason], ['void', 'Payment bounced']);
  assert.deepEqual([subs[0]!.planKey, subs[0]!.status, subs[0]!.currentPeriodEnd.getTime()], ['starter', 'active', at(3).getTime()]);
  assert.equal(audits.find((a) => a.action === 'subscription_payment.void')!.details.subscriptionRestored, true);
});

test('void of a confirmed first payment (no subscription before) leaves the subscription expired, never deleted', async () => {
  payments = [claimed()];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }, ADMIN, NOW);
  await voidPayment({ paymentId: payments[0]!._id, reason: 'Payment bounced' }, ADMIN, NOW);
  assert.equal(subs.length, 1);
  assert.deepEqual([subs[0]!.status, subs[0]!.planKey], ['expired', 'growth']);
});

test('void of a confirmed payment is refused (409, nothing changed) once the subscription moved on: a later cancel, payment or the expiry job', async () => {
  payments = [claimed()];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }, ADMIN, NOW);
  subs[0]!.revision += 1;
  const err = await errorOf(await voidPOST(signed('POST', VOID, { paymentId: payments[0]!._id, reason: 'Payment bounced' })));
  assert.deepEqual([err.status, err.code], [409, 'SUBSCRIPTION_CHANGED']);
  assert.deepEqual([payments[0]!.status, subs[0]!.status], ['confirmed', 'active']);
});

test('if the subscription moves while a confirmed payment is being voided, the payment is put back to confirmed', async () => {
  payments = [claimed()];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }, ADMIN, NOW);
  failSubscriptionUpdate = true;
  const err = await errorOf(await voidPOST(signed('POST', VOID, { paymentId: payments[0]!._id, reason: 'Payment bounced' })));
  assert.deepEqual([err.status, err.code], [409, 'SUBSCRIPTION_CHANGED']);
  assert.deepEqual([payments[0]!.status, payments[0]!.reason], ['confirmed', 'Slip checked']);
});

test('the admin list: filtered by status, paged, newest first, with the seller, the plan name and the number waiting', async () => {
  payments = [claimed(), claimed({ seller: B, isOpen: true, planKey: 'pro', amountRs: 6000 }), payment({ seller: B, status: 'confirmed', isOpen: false }), payment({ seller: A, status: 'rejected', isOpen: false })];
  const all = await json(await internalListGET(signed('GET', LIST)));
  assert.equal(adminPaymentListSchema.safeParse(all).success, true);
  assert.deepEqual([all.totalDocs, all.pendingCount, all.page, all.limit, all.totalPages], [4, 2, 1, 20, 1]);
  assert.equal(all.docs[0].id, payments[3]!._id, 'newest first');
  const pending = await json(await internalListGET(signed('GET', LIST + '?status=claimed')));
  assert.deepEqual([pending.totalDocs, pending.docs.map((d: Row) => d.seller.name).sort(), pending.docs.map((d: Row) => d.planName).sort()], [2, ['Ayesha Khan', 'Bilal Raza'], ['Growth', 'Pro']]);
  const page = await json(await internalListGET(signed('GET', LIST + '?limit=3&page=2')));
  assert.deepEqual([page.docs.length, page.totalPages, page.pendingCount], [1, 2, 2]);
});

test('the admin list rejects an unknown status or parameter with 422', async () => {
  for (const query of ['?status=paid', '?page=0', '?limit=101', '?sort=amount']) assert.equal((await internalListGET(signed('GET', LIST + query))).status, 422, query);
});

// =====================================================================================================================================
// The libraries directly (fixed dates)

test('requestUpgrade and claimPayment work on the seller id they are given: a payment of another seller is a 404', async () => {
  const { payment: created } = await requestUpgrade(A, 'growth', NOW);
  await assert.rejects(() => claimPayment(B, { paymentId: created.id, method: 'bank', reference: 'R-1' }, NOW), (err: any) => err.status === 404);
  const out = await claimPayment(A, { paymentId: created.id, method: 'bank', reference: 'R-1' }, NOW);
  assert.deepEqual([out.status, out.claimedAt], ['claimed', NOW.toISOString()]);
});

test('rejectPayment on a stale id of a payment that is already confirmed is a 409', async () => {
  payments = [claimed()];
  await confirmPayment({ paymentId: payments[0]!._id, amountRs: 2500, reason: 'Slip checked' }, ADMIN, NOW);
  await assert.rejects(() => rejectPayment({ paymentId: payments[0]!._id, reason: 'Changed my mind' }, ADMIN, NOW), (err: any) => err.status === 409 && err.errorCode === 'PAYMENT_NOT_OPEN');
});
