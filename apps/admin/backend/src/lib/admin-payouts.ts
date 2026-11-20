import type { CommissionReport, CreatePayoutRequest, PayoutBalanceList, PayoutFullDetails, PayoutList, PayoutRow } from '../../../../../packages/contracts/src/payouts';
import { AdminHttpError } from '@/lib/admin-auth';
import { ACCOUNT_CODES } from '@/lib/admin-account';
import {
  createPayout,
  finishPayout,
  listPayoutBalances,
  listPayoutHistory,
  readCommissionReport,
  readPayoutDetails,
  voidPayout,
} from '@/lib/seller-moderation-client';
import { writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 4 EP-05.US03, US06 (D-090): the admin side of payouts. The ledger and the payouts live in the SELLER database, so
 * every action is one signed call to the seller backend (seller-moderation-client.ts); what this backend adds is the admin
 * session and policy check (in the routes) and the ADMIN audit entry (here). Written against injectable steps so the tests
 * can stub the seller backend.
 *
 * Audit order: a payout, a void and a finish are audited AFTER the seller backend did them (best effort: the seller backend
 * has written its own entry already). Viewing the full payout account is audited BEFORE the call and fails closed: no entry,
 * no number. No entry here ever holds an account number.
 */

export const payoutSteps = {
  listBalances: listPayoutBalances,
  listHistory: listPayoutHistory,
  create: createPayout,
  void: voidPayout,
  finish: finishPayout,
  details: readPayoutDetails,
  report: readCommissionReport,
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

const errorName = (err: unknown): string => (err instanceof Error ? err.message.slice(0, 200) : 'unknown');

async function auditQuietly(action: string, entity: string, entityId: string, adminId: string, details: Record<string, unknown>): Promise<void> {
  try {
    await payoutSteps.audit(action, entity, entityId, adminId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write a payout audit entry', { action, error: errorName(err) });
  }
}

interface QuerySchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code?: string; keys?: unknown[] }> } };
}

/** The query of a GET, checked with the shared schema: 400 with the field name, as the body routes answer. */
export function readAdminQuery<T>(request: Request, schema: QuerySchema<T>, ignore: readonly string[] = []): T {
  const params = Object.fromEntries([...new URL(request.url).searchParams].filter(([name]) => !ignore.includes(name)));
  const parsed = schema.safeParse(params);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  // An unknown parameter has no path: name the parameter itself, as readAdminBody names an unknown body key.
  const unknownKey = issue?.code === 'unrecognized_keys' && Array.isArray(issue.keys) ? issue.keys[0] : undefined;
  const field = unknownKey !== undefined ? String(unknownKey) : issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'query';
  throw new AdminHttpError(400, issue?.message ?? 'Invalid request', ACCOUNT_CODES.BODY_INVALID, field);
}

export const listBalances = (adminId: string, query: { page: number; limit: number; q?: string | undefined }): Promise<PayoutBalanceList> => payoutSteps.listBalances(adminId, query);

export const listHistory = (adminId: string, query: { page: number; limit: number; storeId?: string | undefined; status?: string | undefined }): Promise<PayoutList> =>
  payoutSteps.listHistory(adminId, query);

export async function makePayout(adminId: string, input: CreatePayoutRequest): Promise<PayoutRow> {
  const row = await payoutSteps.create(adminId, input);
  await auditQuietly('payout.create', 'store', input.storeId, adminId, { payoutId: row.id, amount: row.amount, method: row.method, entryCount: row.entryCount });
  return row;
}

export async function voidExistingPayout(adminId: string, input: { payoutId: string; reason: string }): Promise<PayoutRow> {
  const row = await payoutSteps.void(adminId, input);
  await auditQuietly('payout.void', 'store', row.storeId, adminId, { payoutId: row.id, amount: row.amount, reason: input.reason });
  return row;
}

export async function finishStuckPayout(adminId: string, input: { payoutId: string }): Promise<PayoutRow> {
  const row = await payoutSteps.finish(adminId, input);
  await auditQuietly('payout.finish', 'store', row.storeId, adminId, { payoutId: row.id, result: row.status });
  return row;
}

/** The entry goes in first. If it cannot be written nothing is asked of the seller backend and no number is shown. */
export async function viewPayoutDetails(adminId: string, storeId: string): Promise<PayoutFullDetails> {
  try {
    await payoutSteps.audit('payout_details_viewed', 'store', storeId, adminId, { storeId, at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write the payout details audit entry', { error: errorName(err) });
    throw new AdminHttpError(503, 'The view could not be recorded, so the account details are not shown. Try again.');
  }
  return payoutSteps.details(adminId, { storeId });
}

export const commissionReportFor = (adminId: string, query: { storeId: string; period: string; from?: string | undefined; to?: string | undefined }): Promise<CommissionReport> =>
  payoutSteps.report(adminId, query);
