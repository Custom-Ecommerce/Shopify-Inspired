import type { AdminReferralExport, AdminReferralExportQuery, AdminReferralList, AdminReferralListQuery, AdminReferralRow } from '@markaz/contracts';
import { ADMIN_REFERRAL_EXPORT_CAP } from '@/lib/contracts';
import { maskName } from '@/lib/referrals';
import { assertCan, Referral, User } from '@/lib/services';
import { escapeRegex } from '@/lib/storefront/product-query';

/*
 * Sprint 8 (S8-B6, D-118): what the admin console reads of referrals, behind the signed internal routes. Read only. The referrer is shown with their name and
 * email (the console already shows sellers); the referred seller is a masked name and nothing else (their email is never read here).
 */

type Row = Record<string, any>;

const iso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** UTC days, both included. */
function dayRange(from: string | undefined, to: string | undefined): Record<string, Date> | null {
  const range: Record<string, Date> = {};
  if (from) range.$gte = new Date(from + 'T00:00:00.000Z');
  if (to) range.$lt = new Date(new Date(to + 'T00:00:00.000Z').getTime() + 86_400_000);
  return Object.keys(range).length === 0 ? null : range;
}

async function toRows(rows: Row[]): Promise<AdminReferralRow[]> {
  if (rows.length === 0) return [];
  const referrerIds = [...new Set(rows.map((row) => String(row.referrer)))];
  const referredIds = rows.map((row) => String(row.referred));
  const [referrers, referred] = await Promise.all([
    User.find({ _id: { $in: referrerIds } } as never).select('name email').lean() as unknown as Promise<Row[]>,
    User.find({ _id: { $in: referredIds } } as never).select('name').lean() as unknown as Promise<Row[]>,
  ]);
  const referrerOf = new Map(referrers.map((user) => [String(user._id), user]));
  const referredOf = new Map(referred.map((user) => [String(user._id), user]));
  return rows.map((row) => {
    const owner = referrerOf.get(String(row.referrer));
    return {
      id: String(row._id),
      referrer: { id: String(row.referrer), name: typeof owner?.name === 'string' ? owner.name : '', email: typeof owner?.email === 'string' ? owner.email : '' },
      referred: maskName(referredOf.get(String(row.referred))?.name),
      status: row.status,
      months: typeof row.monthsRewarded === 'number' ? row.monthsRewarded : 0,
      createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
      rewardedAt: iso(row.rewardedAt),
      paymentVoidedAt: iso(row.paymentVoidedAt),
    };
  });
}

export async function listAdminReferrals(query: AdminReferralListQuery): Promise<AdminReferralList> {
  assertCan('admin', 'read', 'referrals');
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  const created = dayRange(query.from, query.to);
  if (created) filter.createdAt = created;
  if (query.q) {
    const pattern = { $regex: escapeRegex(query.q), $options: 'i' };
    const found = (await User.find({ role: 'seller', $or: [{ name: pattern }, { email: pattern }] } as never).select('_id').limit(200).lean()) as unknown as Row[];
    filter.referrer = { $in: found.map((user) => user._id) };
  }
  const [rows, totalDocs] = await Promise.all([
    Referral.find(filter as never)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<Row[]>,
    Referral.countDocuments(filter as never),
  ]);
  return { docs: await toRows(rows), page: query.page, limit: query.limit, totalDocs, totalPages: Math.ceil(totalDocs / query.limit) };
}

/** The rewarded referrals, newest reward first, at most ADMIN_REFERRAL_EXPORT_CAP. */
export async function exportAdminRewards(query: AdminReferralExportQuery): Promise<AdminReferralExport> {
  assertCan('admin', 'read', 'referrals');
  const filter: Record<string, unknown> = { status: 'rewarded' };
  const rewarded = dayRange(query.from, query.to);
  if (rewarded) filter.rewardedAt = rewarded;
  const rows = (await Referral.find(filter as never)
    .sort({ rewardedAt: -1, _id: -1 })
    .limit(ADMIN_REFERRAL_EXPORT_CAP + 1)
    .lean()) as unknown as Row[];
  return { rows: await toRows(rows.slice(0, ADMIN_REFERRAL_EXPORT_CAP)), truncated: rows.length > ADMIN_REFERRAL_EXPORT_CAP };
}
