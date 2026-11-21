import { AdminHttpError } from '@/lib/admin-auth';
import { readSellerPlans } from '@/lib/seller-moderation-client';

/**
 * Sprint 6 EP-14.US02.T08 (D-118): the plans column of the sellers page. Kept out of the route file and written against an injectable step, so
 * the test can stub the signed seller backend call. Read only.
 */
export const sellerPlanSteps = { read: readSellerPlans };

/** At most this many sellers per call (the sellers page lists 20, the seller backend takes 100). */
export const SELLER_PLANS_MAX = 100;

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** The ids of ?ids=a,b,c: trimmed, de-duplicated, each a 24-character ObjectId; anything else is a 400 naming the field. */
export function parseSellerIds(raw: string | null): string[] {
  const ids = [...new Set((raw ?? '').split(',').map((id) => id.trim()).filter((id) => id !== ''))];
  if (ids.length === 0) throw new AdminHttpError(400, 'Name the sellers: ids=<id>,<id>', 'ACCOUNT_BODY_INVALID', 'ids');
  if (ids.length > SELLER_PLANS_MAX) throw new AdminHttpError(400, 'At most ' + SELLER_PLANS_MAX + ' sellers at once', 'ACCOUNT_BODY_INVALID', 'ids');
  if (ids.some((id) => !OBJECT_ID.test(id))) throw new AdminHttpError(400, 'Every id must be a 24-character ObjectId', 'ACCOUNT_BODY_INVALID', 'ids');
  return ids;
}

export async function sellerPlansFor(adminId: string, ids: string[]) {
  return sellerPlanSteps.read(adminId, { sellerIds: ids });
}
