import type { AdminReferralExport, AdminReferralList, AdminReferralRow } from '../../../../../packages/contracts/src/admin-referrals';
import { AdminHttpError } from '@/lib/admin-auth';
import { auditCsvCell } from '@/lib/admin-audit-export';
import { NO_STORE, requirePolicy } from '@/lib/admin-session';
import { readInteger } from '@/lib/admin-stores';
import { CSV_BOM } from '@/lib/commission-report-csv';
import { exportReferralRewards, listReferrals } from '@/lib/seller-moderation-client';
import { assertCan, writeAuditLog } from '@/lib/workspace';

/*
 * Sprint 8 (S8-B6, D-118): the admin console's READ-ONLY view of referrals and the CSV of rewards. Capability referrals.read (owner, finance), declared by the
 * route files. Each read is one signed call to the seller backend, which masks the referred seller. The export uses the formula guard of the audit CSV, is
 * UTF-8 with a BOM, holds at most 5000 rows, and is audited BEFORE the file is returned (no entry, no file).
 */

export const referralSteps = {
  list: listReferrals as (adminId: string, input: Record<string, unknown>) => Promise<AdminReferralList>,
  export: exportReferralRewards as (adminId: string, input: Record<string, unknown>) => Promise<AdminReferralExport>,
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

const STATUSES = ['pending', 'rewarded', 'capped', 'refused'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const bad = (field: string, message: string): AdminHttpError => new AdminHttpError(400, message, 'ACCOUNT_BODY_INVALID', field);

function days(params: URLSearchParams): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  for (const name of ['from', 'to'] as const) {
    const value = (params.get(name) ?? '').trim();
    if (value === '') continue;
    if (!DAY.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) throw bad(name, 'Use a date like 2026-11-20.');
    out[name] = value;
  }
  if (out.from && out.to && out.from > out.to) throw bad('from', 'The start date is after the end date.');
  return out;
}

export function parseReferralQuery(params: URLSearchParams): Record<string, unknown> {
  const status = (params.get('status') ?? '').trim();
  if (status !== '' && !(STATUSES as readonly string[]).includes(status)) throw bad('status', 'Choose a status from the list.');
  const q = (params.get('q') ?? '').trim();
  if (q.length > 100) throw bad('q', 'At most 100 characters.');
  const page = readInteger(params.get('page'), 1, 1, 10000);
  if (page === null) throw bad('page', 'The page must be a whole number from 1.');
  const limit = readInteger(params.get('limit'), 20, 1, 50);
  if (limit === null) throw bad('limit', 'The limit must be a whole number from 1 to 50.');
  return { ...(status === '' ? {} : { status }), ...(q === '' ? {} : { q }), ...days(params), page, limit };
}

/** GET /api/admin/referrals?status&q&from&to&page&limit */
export async function listReferralsFor(request: Request, adminId: string): Promise<Response> {
  requirePolicy(() => assertCan('admin', 'read', 'referrals'));
  const query = parseReferralQuery(new URL(request.url).searchParams);
  return Response.json(await referralSteps.list(adminId, query), { status: 200, headers: NO_STORE });
}

export const REFERRAL_CSV_HEADER = ['Referral id', 'Referrer name', 'Referrer email', 'Referred (masked)', 'Months', 'Signed up (UTC)', 'Rewarded (UTC)', 'Payment voided after reward (UTC)'] as const;

export function toReferralCsv(rows: readonly AdminReferralRow[]): string {
  const lines = [REFERRAL_CSV_HEADER.map(auditCsvCell).join(',')];
  for (const row of rows) {
    lines.push([row.id, row.referrer.name, row.referrer.email, row.referred, row.months, row.createdAt, row.rewardedAt, row.paymentVoidedAt].map(auditCsvCell).join(','));
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/** GET /api/admin/referrals/export?from&to */
export async function exportReferralsFor(request: Request, adminId: string): Promise<Response> {
  requirePolicy(() => assertCan('admin', 'read', 'referrals'));
  const range = days(new URL(request.url).searchParams);
  const data = await referralSteps.export(adminId, range);
  const csv = toReferralCsv(data.rows);
  try {
    await referralSteps.audit('referrals.exported', 'referral', 'export', adminId, { filters: range, rows: data.rows.length, truncated: data.truncated, at: new Date().toISOString() });
  } catch {
    throw new AdminHttpError(503, 'The export could not be made because its audit entry could not be written.');
  }
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="referral-rewards.csv"',
      'cache-control': 'no-store',
      'x-export-truncated': data.truncated ? 'true' : 'false',
    },
  });
}
