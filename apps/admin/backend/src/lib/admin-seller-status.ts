import { AdminHttpError } from '@/lib/admin-auth';
import { setSellerAccountStatus } from '@/lib/seller-moderation-client';
import { User, writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 4 EP-08.US03.T02 (D-093): suspend or unsuspend a seller account. Kept out of the route file (Next allows only
 * route exports there) and written against injectable steps, so the test can stub the seller backend call.
 *
 * Order: refuse self and admins -> compare-and-set on the status read (admin database) -> the signed call that applies it
 * in the seller database (where the seller's requests are checked) -> on a failed call the admin write is put back ->
 * audit (best effort). A suspended seller's storefront stays up: only the account is refused, the stores are untouched.
 */

export interface SellerStatusChange {
  adminId: string;
  sellerId: string;
  status: 'active' | 'suspended';
  reason: string | null;
}

export interface SellerStatusResult {
  id: string;
  accountStatus: 'active' | 'suspended';
  changed: boolean;
}

export const sellerStatusSteps = {
  applyInSellerBackend: setSellerAccountStatus,
};

export async function changeSellerStatus(change: SellerStatusChange): Promise<SellerStatusResult> {
  if (change.adminId === change.sellerId) throw new AdminHttpError(403, 'You cannot suspend your own account.', 'SELF_SUSPEND');

  const current = (await User.findById(change.sellerId).select('role accountStatus').lean()) as { role?: unknown; accountStatus?: unknown } | null;
  if (!current) throw new AdminHttpError(404, 'Seller not found');
  if (current.role !== 'seller') throw new AdminHttpError(403, 'Only seller accounts can be suspended here.', 'NOT_A_SELLER');

  const from = current.accountStatus === 'suspended' || current.accountStatus === 'blocked' ? String(current.accountStatus) : 'active';
  if (from === change.status) {
    // Still applied in the seller database, so an earlier half-done change is completed by a retry.
    await sellerStatusSteps.applyInSellerBackend(change.adminId, { userId: change.sellerId, status: change.status, reason: change.reason });
    return { id: change.sellerId, accountStatus: change.status, changed: false };
  }
  if (from === 'blocked') throw new AdminHttpError(409, 'This account is blocked and cannot be changed here.', 'ACCOUNT_BLOCKED');

  const updated = await User.findOneAndUpdate(
    { _id: change.sellerId, role: 'seller', accountStatus: from === 'active' ? { $in: ['active', null] } : from },
    { $set: { accountStatus: change.status, suspensionReason: change.status === 'suspended' ? change.reason : null } },
    { new: true },
  )
    .select('accountStatus')
    .lean();
  if (!updated) throw new AdminHttpError(409, 'The account was changed by someone else. Reload and try again.');

  try {
    await sellerStatusSteps.applyInSellerBackend(change.adminId, { userId: change.sellerId, status: change.status, reason: change.reason });
  } catch (err) {
    // Put the admin copy back, so the console never shows a status the seller backend does not enforce.
    try {
      await User.updateOne({ _id: change.sellerId, accountStatus: change.status }, { $set: { accountStatus: from, suspensionReason: null } });
    } catch (rollbackErr) {
      console.error('[admin-backend] could not put a seller status back', rollbackErr instanceof Error ? rollbackErr.message : 'unknown');
    }
    throw err;
  }

  try {
    await writeAuditLog(change.status === 'suspended' ? 'seller.suspend' : 'seller.unsuspend', 'user', change.sellerId, change.adminId, {
      from,
      to: change.status,
      reason: change.reason,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin-backend] could not write the seller status audit entry', err instanceof Error ? err.message : 'unknown');
  }
  return { id: change.sellerId, accountStatus: change.status, changed: true };
}

