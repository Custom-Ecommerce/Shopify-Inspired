import { AdminHttpError } from '@/lib/admin-auth';
import { SETTINGS_GLOBAL_TYPE } from '@/lib/admin-commission';
import { setSellerStoreLimit } from '@/lib/seller-moderation-client';
import { PlatformSettingsModel, Store, User, writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 6 EP-12.US02.T02 (D-118): a seller's store-limit override, set (an integer of 1 or more) or cleared (null) by an admin with a
 * reason. Kept out of the route file (Next allows only route exports there) and written against injectable steps, so the test can stub the
 * seller backend call. The same shape as the seller status call (lib/admin-seller-status.ts, D-093):
 *
 *   read the seller -> compare-and-set on the value read (admin database) -> the signed call that applies it in the seller database, where
 *   provisionStore reads it -> on a failed call the admin write is put back -> audit (best effort, with the reason).
 *
 * The effective limit shown to the operator (describeStoreLimit) follows the same order as the seller backend's lib/effective-limits.ts:
 * override > plan > platform setting > environment (SELLER_MAX_STORES, else 3). The two are separate copies on purpose: the apps share code
 * only through packages. There is no plan limit until EP-14.
 */

export const STORE_LIMIT_SOURCES = ['override', 'plan', 'setting', 'env'] as const;
export type StoreLimitSource = (typeof STORE_LIMIT_SOURCES)[number];
export const DEFAULT_ENV_STORE_LIMIT = 3;

const positiveWhole = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null);

/** SELLER_MAX_STORES the way the seller backend reads it (parseInt; a whole number of 1 or more), else null. */
export function envStoreLimit(raw: unknown): number | null {
  return typeof raw === 'string' ? positiveWhole(Number.parseInt(raw, 10)) : null;
}

export interface StoreLimitView {
  effectiveLimit: number;
  source: StoreLimitSource;
  storeLimitOverride: number | null;
  planLimit: number | null;
  platformMax: number | null;
  envMax: number;
}

/** The effective limit and where it comes from. Pure. Unusable values at a step are skipped, as in the seller backend. */
export function describeStoreLimit(input: { override?: unknown; planLimit?: unknown; platformMax?: unknown; envMax?: unknown }): StoreLimitView {
  const override = positiveWhole(input.override);
  const planLimit = positiveWhole(input.planLimit);
  const platformMax = positiveWhole(input.platformMax);
  const envMax = envStoreLimit(input.envMax) ?? positiveWhole(input.envMax) ?? DEFAULT_ENV_STORE_LIMIT;
  if (override !== null) return { effectiveLimit: override, source: 'override', storeLimitOverride: override, planLimit, platformMax, envMax };
  if (planLimit !== null) return { effectiveLimit: planLimit, source: 'plan', storeLimitOverride: null, planLimit, platformMax, envMax };
  if (platformMax !== null) return { effectiveLimit: platformMax, source: 'setting', storeLimitOverride: null, planLimit, platformMax, envMax };
  return { effectiveLimit: envMax, source: 'env', storeLimitOverride: null, planLimit, platformMax, envMax };
}

export const storeLimitSteps = {
  applyInSellerBackend: setSellerStoreLimit,
};

export interface StoreLimitChange {
  adminId: string;
  sellerId: string;
  /** An integer of 1 or more, or null to clear. */
  storeLimitOverride: number | null;
  reason: string;
}

export interface StoreLimitResult {
  id: string;
  storeLimitOverride: number | null;
  changed: boolean;
}

export async function changeStoreLimit(change: StoreLimitChange): Promise<StoreLimitResult> {
  const current = (await User.findById(change.sellerId).select('role storeLimitOverride').lean()) as { role?: unknown; storeLimitOverride?: unknown } | null;
  if (!current) throw new AdminHttpError(404, 'Seller not found');
  if (current.role !== 'seller') throw new AdminHttpError(403, 'The store limit is set on seller accounts only.', 'NOT_A_SELLER');

  const from = positiveWhole(current.storeLimitOverride);
  if (from === change.storeLimitOverride) {
    // Still applied in the seller database, so an earlier half-done change is completed by a retry.
    await storeLimitSteps.applyInSellerBackend(change.adminId, { userId: change.sellerId, storeLimitOverride: change.storeLimitOverride });
    return { id: change.sellerId, storeLimitOverride: change.storeLimitOverride, changed: false };
  }

  // null in the filter matches both a null and a missing field.
  const updated = await User.findOneAndUpdate(
    { _id: change.sellerId, role: 'seller', storeLimitOverride: from },
    { $set: { storeLimitOverride: change.storeLimitOverride } },
    { new: true },
  )
    .select('storeLimitOverride')
    .lean();
  if (!updated) throw new AdminHttpError(409, 'The store limit was changed by someone else. Reload and try again.');

  try {
    await storeLimitSteps.applyInSellerBackend(change.adminId, { userId: change.sellerId, storeLimitOverride: change.storeLimitOverride });
  } catch (err) {
    // Put the admin copy back, so the console never shows a limit the seller backend does not enforce.
    try {
      await User.updateOne({ _id: change.sellerId, storeLimitOverride: change.storeLimitOverride }, { $set: { storeLimitOverride: from } });
    } catch (rollbackErr) {
      console.error('[admin-backend] could not put a store limit back', rollbackErr instanceof Error ? rollbackErr.message : 'unknown');
    }
    throw err;
  }

  try {
    await writeAuditLog(change.storeLimitOverride === null ? 'seller.store_limit_cleared' : 'seller.store_limit_set', 'user', change.sellerId, change.adminId, {
      from,
      to: change.storeLimitOverride,
      reason: change.reason,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin-backend] could not write the store limit audit entry', err instanceof Error ? err.message : 'unknown');
  }
  return { id: change.sellerId, storeLimitOverride: change.storeLimitOverride, changed: true };
}

/** What the Store limit dialog shows: the seller, the effective limit and where it comes from, and how many stores the seller has. */
export async function readStoreLimit(sellerId: string) {
  const seller = (await User.findById(sellerId).select('role name email storeLimitOverride').lean()) as
    | { role?: unknown; name?: unknown; email?: unknown; storeLimitOverride?: unknown }
    | null;
  if (!seller) throw new AdminHttpError(404, 'Seller not found');
  if (seller.role !== 'seller') throw new AdminHttpError(403, 'The store limit is set on seller accounts only.', 'NOT_A_SELLER');

  let platformMax: unknown = null;
  try {
    const settings = (await PlatformSettingsModel.findOne({ globalType: SETTINGS_GLOBAL_TYPE } as never)
      .select('maxStoresPerSeller')
      .lean()) as unknown as { maxStoresPerSeller?: unknown } | null;
    platformMax = settings?.maxStoresPerSeller ?? null;
  } catch {
    platformMax = null;
  }
  const storesUsed = await Store.countDocuments({ owner: sellerId } as never);
  const view = describeStoreLimit({ override: seller.storeLimitOverride, planLimit: null, platformMax, envMax: process.env.SELLER_MAX_STORES });
  return {
    id: sellerId,
    name: typeof seller.name === 'string' ? seller.name : '',
    email: typeof seller.email === 'string' ? seller.email : '',
    storeLimitOverride: view.storeLimitOverride,
    effectiveLimit: view.effectiveLimit,
    source: view.source,
    storesUsed,
    planLimit: view.planLimit,
    platformMax: view.platformMax,
    envMax: view.envMax,
  };
}
