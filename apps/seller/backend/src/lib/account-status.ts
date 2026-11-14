import { HttpError } from '@/lib/http';
import { forgetSessionUser } from '@/lib/session-user';
import { User, writeAuditLog } from '@/lib/services';

/* Sprint 4 EP-08.US03: kept out of the route file (Next allows only route exports there). */

export interface AccountStatusInput {
  userId: string;
  status: 'active' | 'suspended' | 'blocked';
  reason?: string | null;
}

/**
 * Applies a seller account status in the seller database, where authenticate() reads it (EP-08.US03.T02, D-093).
 * Answers { userId, status, changed }. Setting the status the account already has is a 200 no-op, so a retry, or a
 * shared database where the admin backend already wrote it, is harmless.
 */
export async function applyAccountStatus(input: AccountStatusInput, adminId: string): Promise<{ userId: string; status: string; changed: boolean }> {
  const current = (await User.findOne({ _id: input.userId, role: 'seller' }).select('accountStatus').lean()) as { accountStatus?: unknown } | null;
  if (!current) throw new HttpError(404, 'Seller account not found');
  const from = typeof current.accountStatus === 'string' ? current.accountStatus : 'active';
  if (from === input.status) {
    forgetSessionUser(input.userId);
    return { userId: input.userId, status: input.status, changed: false };
  }

  // Compare-and-set on the status read, so two operators at once leave one change. A missing field reads as active.
  const fromFilter = from === 'active' ? { $in: ['active', null] } : from;
  const updated = await User.findOneAndUpdate(
    { _id: input.userId, role: 'seller', accountStatus: fromFilter },
    { $set: { accountStatus: input.status, suspensionReason: input.status === 'active' ? null : (input.reason ?? null) } },
    { new: true },
  )
    .select('accountStatus')
    .lean();
  forgetSessionUser(input.userId);
  if (!updated) throw new HttpError(409, 'The account was changed by someone else. Reload and try again.');

  try {
    await writeAuditLog('user.account_status', 'user', input.userId, 'admin:' + adminId, { from, to: input.status, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the account status audit entry', err instanceof Error ? err.message : 'unknown');
  }
  return { userId: input.userId, status: input.status, changed: true };
}
