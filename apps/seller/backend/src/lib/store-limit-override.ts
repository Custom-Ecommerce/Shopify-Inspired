import { HttpError } from '@/lib/http';
import { positiveWhole } from '@/lib/effective-limits';
import { User, assertCan, writeAuditLog } from '@/lib/services';

/* Sprint 6 EP-12.US02.T02 (D-118): kept out of the route file (Next allows only route exports there). */

export interface StoreLimitOverrideInput {
  userId: string;
  /** An integer of 1 or more, or null to clear the override. */
  storeLimitOverride: number | null;
}

/**
 * Applies a seller's store-limit override in the seller database, where provisionStore and the workspace read it (POST
 * /api/internal/accounts/store-limit, signed by the admin backend like the account status call, D-093). Setting the value the account
 * already has is a 200 no-op, so a retry, or a shared database where the admin backend already wrote it, is harmless. The write is a
 * compare-and-set on the value that was read, so two operators at once leave one change. Only the admin backend's signature reaches
 * here; the policy check says so again: nobody but an admin writes this field.
 */
export async function applyStoreLimitOverride(
  input: StoreLimitOverrideInput,
  adminId: string,
): Promise<{ userId: string; storeLimitOverride: number | null; changed: boolean }> {
  assertCan('admin', 'update', 'sellers', ['storeLimitOverride']);
  const current = (await User.findOne({ _id: input.userId, role: 'seller' }).select('storeLimitOverride').lean()) as { storeLimitOverride?: unknown } | null;
  if (!current) throw new HttpError(404, 'Seller account not found');
  const from = positiveWhole(current.storeLimitOverride);
  if (from === input.storeLimitOverride) return { userId: input.userId, storeLimitOverride: input.storeLimitOverride, changed: false };

  // A missing field and null are the same "no override" for the filter.
  const updated = await User.findOneAndUpdate(
    { _id: input.userId, role: 'seller', storeLimitOverride: from },
    { $set: { storeLimitOverride: input.storeLimitOverride } },
    { new: true },
  )
    .select('storeLimitOverride')
    .lean();
  if (!updated) throw new HttpError(409, 'The store limit was changed by someone else. Reload and try again.');

  try {
    await writeAuditLog('user.store_limit', 'user', input.userId, 'admin:' + adminId, { from, to: input.storeLimitOverride, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the store limit audit entry', err instanceof Error ? err.name : 'unknown');
  }
  return { userId: input.userId, storeLimitOverride: input.storeLimitOverride, changed: true };
}
