import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { Referral, User } from '@/lib/services';
import { exportAdminRewards, listAdminReferrals } from '../src/lib/admin-referrals';

// Sprint 8 (S8-B6, D-118): what the seller backend answers the admin console about referrals. Models are stubbed.

const { adminReferralExportSchema, adminReferralListQuerySchema, adminReferralListSchema, ADMIN_REFERRAL_EXPORT_CAP } = unwrapCjs(contractsNs) as typeof contractsNs;

type Row = Record<string, any>;
const REFERRER = '65a000000000000000000001';
const REFERRED = '65a000000000000000000002';
let rows: Row[];
let filters: Row[];
let selects: string[];
let restore: () => void = () => {};

const query = (value: () => unknown) => {
  const q: any = { select: (s: string) => (selects.push(s), q), sort: () => q, skip: () => q, limit: () => q, lean: async () => value() };
  return q;
};

beforeEach(() => {
  rows = [{ _id: '65a0000000000000000000b1', referrer: REFERRER, referred: REFERRED, status: 'rewarded', monthsRewarded: 1, createdAt: new Date('2026-11-01'), rewardedAt: new Date('2026-11-20') }];
  filters = [];
  selects = [];
  const R = Referral as any;
  const U = User as any;
  const saved = { find: R.find, count: R.countDocuments, users: U.find };
  R.find = (filter: Row) => (filters.push(filter), query(() => rows));
  R.countDocuments = async () => rows.length;
  U.find = () => query(() => [{ _id: REFERRER, name: 'Sana Khan', email: 'sana@example.com' }, { _id: REFERRED, name: 'Bilal Ahmed', email: 'bilal.secret@example.com' }]);
  restore = () => {
    R.find = saved.find;
    R.countDocuments = saved.count;
    U.find = saved.users;
  };
});
afterEach(() => restore());

test('the list: the referrer with name and email, the referred seller masked, never the referred email', async () => {
  const out = await listAdminReferrals(adminReferralListQuerySchema.parse({ status: 'rewarded', from: '2026-11-01', to: '2026-11-30' }));
  assert.equal(adminReferralListSchema.safeParse(out).success, true, JSON.stringify(out));
  assert.deepEqual([out.docs[0]!.referrer.email, out.docs[0]!.referred, out.docs[0]!.months], ['sana@example.com', 'B*** A.', 1]);
  assert.doesNotMatch(JSON.stringify(out), /bilal\.secret|Bilal Ahmed/);
  assert.equal(filters[0]!.status, 'rewarded');
  assert.equal(filters[0]!.createdAt.$gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(filters[0]!.createdAt.$lt.toISOString(), '2026-12-01T00:00:00.000Z');
});

test('the export holds rewarded referrals only, by the day of the reward, at most the cap', async () => {
  rows = Array.from({ length: ADMIN_REFERRAL_EXPORT_CAP + 1 }, () => rows[0]!);
  const out = await exportAdminRewards({ from: '2026-11-01' });
  assert.equal(out.truncated, true);
  assert.equal(out.rows.length, ADMIN_REFERRAL_EXPORT_CAP);
  assert.equal(adminReferralExportSchema.safeParse(out).success, true);
  assert.equal(filters[0]!.status, 'rewarded');
  assert.ok(filters[0]!.rewardedAt.$gte);
});

test('the query is strict: an unknown filter, status or day is refused', () => {
  for (const bad of [{ evil: 1 }, { status: 'paid' }, { from: '1 November' }, { limit: 51 }, { page: 0 }]) assert.equal(adminReferralListQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
});
