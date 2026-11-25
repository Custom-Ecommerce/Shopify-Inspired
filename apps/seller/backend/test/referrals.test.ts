import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { PlatformSettingsModel, Referral, Store, User, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { useMemoryAuthLimits } from '../src/lib/account-support';
import { setMembershipLoader } from '../src/lib/data-plane';
import { ensureReferralCode, generateReferralCode, isSelfReferral, mailboxOf, maskName } from '../src/lib/referrals';
import { setSessionUserLoader } from '../src/lib/session-user';

// Sprint 8 (S8-B5, D-118): the referral code, its capture at signup with the anti-fraud rules, and the referrer's read. Models are in memory; no database.

const { referralOverviewSchema } = unwrapCjs(contractsNs) as typeof contractsNs;

const SECRET = 'x'.repeat(40);
const REFERRER = '65a000000000000000000001';
const MANAGER = '65a000000000000000000003';
const STORE_A = '65a000000000000000000011';
const CODE = 'SANA2345';
const NEW_ID = (n: number) => '65a0000000000000000000' + String(40 + n);

type Row = Record<string, any>;
const UserModel = User as any;
const ReferralModel = Referral as any;
const StoreModel = Store as any;
const SettingsModel = PlatformSettingsModel as any;

let users: Row[];
let referrals: Row[];
let settings: Row | null;
let selects: string[];
let failCreate: Error | null;
let restore: () => void = () => {};
let signup: (request: Request) => Promise<Response>;
let referralsGET: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.test';
  signup = (await import('../src/app/api/signup/route')).POST;
  referralsGET = (await import('../src/app/api/referrals/route')).GET;
});

const matches = (row: Row, filter: Row): boolean =>
  Object.entries(filter).every(([key, wanted]) => {
    if (wanted === null) return row[key] === null || row[key] === undefined;
    if (typeof wanted === 'object' && wanted.$in) return wanted.$in.map(String).includes(String(row[key]));
    return String(row[key]) === String(wanted);
  });

function query(value: () => unknown) {
  const q: any = { select: (fields: string) => (selects.push(fields), q), sort: () => q, limit: () => q, lean: async () => value() };
  return q;
}

beforeEach(() => {
  useMemoryAuthLimits();
  users = [
    { _id: REFERRER, role: 'seller', name: 'Sana Khan', email: 'sana.khan@gmail.com', phone: '+923001234567', accountStatus: 'active', referralCode: CODE },
    { _id: MANAGER, role: 'seller', name: 'Manager', email: 'manager@example.com' },
  ];
  referrals = [];
  settings = null;
  selects = [];
  failCreate = null;
  let created = 0;

  const saved = {
    connect: (mongoose as any).connect,
    user: Object.fromEntries(['exists', 'create', 'find', 'findOne', 'findById', 'findOneAndUpdate', 'updateOne'].map((m) => [m, UserModel[m]])),
    referral: { create: ReferralModel.create, find: ReferralModel.find },
    store: { exists: StoreModel.exists, findOne: StoreModel.findOne },
    settings: SettingsModel.findOne,
  };
  (mongoose as any).connect = async () => mongoose;
  UserModel.exists = async (filter: Row) => (users.some((row) => matches(row, filter)) ? { _id: 'x' } : null);
  UserModel.create = async (doc: Row) => {
    created += 1;
    const row = { _id: NEW_ID(created), ...doc };
    users.push(row);
    return row;
  };
  UserModel.find = (filter: Row) => query(() => users.filter((row) => matches(row, filter)));
  UserModel.findOne = (filter: Row) => query(() => users.find((row) => matches(row, filter)) ?? null);
  UserModel.findById = (id: unknown) => query(() => users.find((row) => row._id === String(id)) ?? null);
  UserModel.findOneAndUpdate = (filter: Row, update: Row) =>
    query(() => {
      const row = users.find((r) => matches(r, filter));
      if (!row) return null;
      if (users.some((other) => other !== row && other.referralCode === update.$set.referralCode)) throw Object.assign(new Error('E11000'), { code: 11000 });
      Object.assign(row, update.$set);
      return row;
    });
  UserModel.updateOne = async (filter: Row, update: Row) => {
    const row = users.find((r) => matches(r, filter));
    if (row) Object.assign(row, update.$set);
    return { matchedCount: row ? 1 : 0 };
  };
  ReferralModel.create = async (doc: Row) => {
    if (failCreate) throw failCreate;
    if (referrals.some((row) => row.referred === doc.referred)) throw Object.assign(new Error('E11000'), { code: 11000 });
    const row = { _id: '65a0000000000000000000' + String(70 + referrals.length), ...doc, referrer: String(doc.referrer), createdAt: new Date(Date.UTC(2026, 10, 25, 10, referrals.length)) };
    referrals.push(row);
    return row;
  };
  ReferralModel.find = (filter: Row) => query(() => referrals.filter((row) => matches(row, filter)));
  StoreModel.exists = async (filter: Row) => (String(filter._id) === STORE_A && String(filter.owner) === REFERRER ? { _id: STORE_A } : null);
  StoreModel.findOne = () => query(() => null);
  SettingsModel.findOne = () => query(() => settings);
  setSessionUserLoader(async () => ({ role: 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date() }) as never);
  setMembershipLoader(async (storeId, userId) => (storeId === STORE_A && userId === MANAGER ? { role: 'manager' } : null));
  restore = () => {
    (mongoose as any).connect = saved.connect;
    Object.assign(UserModel, saved.user);
    Object.assign(ReferralModel, saved.referral);
    Object.assign(StoreModel, saved.store);
    SettingsModel.findOne = saved.settings;
    setSessionUserLoader(null);
    setMembershipLoader(null);
  };
});

afterEach(() => restore());

let seq = 0;
function join(extra: Row = {}, url = 'http://seller.test/api/signup'): Promise<Response> {
  seq += 1;
  const body = { name: 'Bilal Ahmed', email: 'new' + seq + '@example.com', password: 'longenough', ...extra };
  return signup(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}

/** What a signup answers, without the parts that differ between any two accounts. */
async function shape(res: Response): Promise<unknown> {
  const body = (await res.json()) as { success: boolean; token: string; user: Row };
  return { status: res.status, keys: Object.keys(body).sort(), user: Object.keys(body.user).sort() };
}

const newUser = () => users[users.length - 1]!;

test('a code is 8 characters of an alphabet with no 0, O, 1, I or L, and codes do not repeat', () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateReferralCode()));
  assert.equal(codes.size, 200);
  for (const code of codes) assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/);
});

test('the code is made once: the same one comes back, and a code already taken is drawn again', async () => {
  const draws = [CODE, 'NEWC2345'];
  const first = await ensureReferralCode(MANAGER, () => draws.shift()!);
  assert.equal(first, 'NEWC2345');
  assert.equal(await ensureReferralCode(MANAGER, () => assert.fail('no second code') as never), 'NEWC2345');
  assert.equal(await ensureReferralCode(REFERRER), CODE);
});

test('masking shows two initials at most', () => {
  assert.equal(maskName('Sana Khan'), 'S*** K.');
  assert.equal(maskName('  ali  raza  butt '), 'A*** B.');
  assert.equal(maskName('Bilal'), 'B***');
  assert.equal(maskName(''), 'Seller');
  assert.equal(maskName(undefined), 'Seller');
});

test('self-referral: the same mailbox (+tags everywhere, dots for Gmail only) or the same mobile', () => {
  assert.equal(mailboxOf(' Sana.Khan+shop@GoogleMail.com '), 'sanakhan@gmail.com');
  assert.equal(mailboxOf('a.b+x@example.com'), 'a.b@example.com');
  const me = { email: 'sana.khan@gmail.com', phone: '+923001234567' };
  for (const email of ['sana.khan@gmail.com', 'sanakhan@gmail.com', 's.a.n.a.khan+2@gmail.com', 'SANAKHAN@googlemail.com']) assert.equal(isSelfReferral(me, { email }), true, email);
  assert.equal(isSelfReferral(me, { email: 'other@example.com', phone: '0300-1234567' }), true);
  assert.equal(isSelfReferral({ email: 'a.b@example.com' }, { email: 'ab@example.com' }), false, 'dots matter outside Gmail');
  assert.equal(isSelfReferral({ email: 'x@example.com', pendingEmail: 'y@example.com' }, { email: 'y+1@example.com' }), true);
  assert.equal(isSelfReferral(me, { email: 'other@example.com', phone: '03111111111' }), false);
  assert.equal(isSelfReferral({ email: 'x@example.com' }, { email: 'y@example.com', phone: null }), false, 'two missing phones are not the same phone');
});

test('a known code records one pending referral and referredBy; the code may be typed in any case, in the body or as ?ref=', async () => {
  assert.equal((await join({ ref: CODE.toLowerCase() })).status, 201);
  assert.deepEqual(referrals.map((row) => [row.referrer, row.referred, row.status, row.monthsRewarded, row.rewardedAt]), [[REFERRER, newUser()._id, 'pending', 0, null]]);
  assert.equal(String(newUser().referredBy), REFERRER);
  await join({}, 'http://seller.test/api/signup?ref=' + CODE);
  assert.equal(referrals.length, 2);
});

test('an unknown or malformed code is ignored without any error or hint: the answer is the same as with a good code or none', async () => {
  const expected = await shape(await join());
  assert.deepEqual(await shape(await join({ ref: CODE })), expected);
  referrals = [];
  for (const ref of ['ZZZZ9999', 'nope', '', 42, { $ne: null }, 'x'.repeat(5000)]) {
    assert.deepEqual(await shape(await join({ ref })), expected, String(ref).slice(0, 20));
    assert.equal(newUser().referredBy, undefined);
  }
  assert.equal(referrals.length, 0);
});

test('a self-referral by email or phone is refused silently: the signup succeeds, no row, no referredBy', async () => {
  for (const extra of [{ email: 'sanakhan@gmail.com' }, { email: 'sana.khan+two@gmail.com' }, { phone: '03001234567' }]) {
    const res = await join({ ...extra, ref: CODE });
    assert.equal(res.status, 201, JSON.stringify(extra));
    assert.equal(newUser().referredBy, undefined);
    // The token is random text, so it is left out of the search for a hint.
    const { token: _token, ...rest } = (await res.json()) as Row;
    assert.doesNotMatch(JSON.stringify(rest), /referr|reward|self/i);
  }
  assert.equal(referrals.length, 0);
});

test('referrals off (referralRewardMonths 0) or a cap of 0: no new rows', async () => {
  for (const doc of [{ referralRewardMonths: 0 }, { referralMonthlyCap: 0 }]) {
    settings = doc;
    assert.equal((await join({ ref: CODE })).status, 201);
  }
  assert.equal(referrals.length, 0);
});

test('a referrer gets at most referralMonthlyCap new referrals a day; the rest sign up all the same', async () => {
  settings = { referralMonthlyCap: 2 };
  for (let i = 0; i < 4; i += 1) assert.equal((await join({ ref: CODE })).status, 201);
  assert.equal(referrals.length, 2);
  assert.equal(newUser().referredBy, undefined);
});

test('a suspended referrer earns nothing; a failing referral write or a second row for one seller never fails the signup', async () => {
  users[0]!.accountStatus = 'suspended';
  assert.equal((await join({ ref: CODE })).status, 201);
  users[0]!.accountStatus = 'active';
  const savedError = console.error;
  console.error = () => {};
  try {
    for (const err of [new Error('down'), Object.assign(new Error('E11000'), { code: 11000 })]) {
      failCreate = err;
      assert.equal((await join({ ref: CODE })).status, 201);
      assert.equal(newUser().referredBy, undefined);
    }
  } finally {
    console.error = savedError;
  }
  assert.equal(referrals.length, 0);
});

test('a referral cannot be created for an existing account: signing up with its email is 409 and writes nothing', async () => {
  const res = await join({ email: 'manager@example.com', ref: CODE });
  assert.equal(res.status, 409);
  assert.equal(referrals.length, 0);
  assert.equal(users[1]!.referredBy, undefined);
});

async function read(userId: string, store = STORE_A): Promise<Response> {
  const token = await signSession({ sub: userId, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  return referralsGET(new NextRequest('http://seller.test/api/referrals', { headers: { authorization: 'Bearer ' + token, 'x-store-id': store } }));
}

test('the owner reads the code, the share link and masked rows; never the referred seller email', async () => {
  await join({ ref: CODE, name: 'Hamza Tariq', email: 'hamza.secret@example.com' });
  await join({ ref: CODE, name: 'Zoya' });
  Object.assign(referrals[0]!, { status: 'rewarded', monthsRewarded: 1, rewardedAt: new Date(Date.UTC(2026, 10, 26)) });
  selects = [];
  const res = await read(REFERRER);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.doesNotMatch(text, /hamza\.secret|@example|Tariq|Hamza/);
  const body = referralOverviewSchema.parse(JSON.parse(text));
  assert.equal(body.code, CODE);
  assert.equal(body.shareLink, 'https://seller.markazify.test/signup?ref=' + CODE);
  assert.equal(body.enabled, true);
  assert.deepEqual(body.totals, { referred: 2, pending: 1, rewarded: 1, monthsEarned: 1 });
  assert.deepEqual(body.referrals.map((row) => row.name).sort(), ['H*** T.', 'Z***']);
  for (const fields of selects) assert.doesNotMatch(fields, /email/i, 'no read of the page asks for an email');
});

test('the referred seller sees no reward information: their own list is empty and says nothing of who referred them', async () => {
  await join({ ref: CODE });
  const referred = newUser()._id;
  StoreModel.exists = async (filter: Row) => (String(filter.owner) === referred ? { _id: STORE_A } : null);
  const body = referralOverviewSchema.parse(await (await read(referred)).json());
  assert.deepEqual(body.referrals, []);
  assert.deepEqual(body.totals, { referred: 0, pending: 0, rewarded: 0, monthsEarned: 0 });
  assert.notEqual(body.code, CODE);
  assert.doesNotMatch(JSON.stringify(body), /referredBy|Sana/);
});

test('owner only: a manager of the store is refused', async () => {
  const res = await read(MANAGER);
  assert.equal(res.status, 403);
  assert.equal((await res.text()).includes(CODE), false);
});

test('with referrals off the page says so and keeps the code', async () => {
  settings = { referralRewardMonths: 0 };
  const body = referralOverviewSchema.parse(await (await read(REFERRER)).json());
  assert.deepEqual([body.enabled, body.rewardMonths, body.code], [false, 0, CODE]);
});
