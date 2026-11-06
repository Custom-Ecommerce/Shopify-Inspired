import { objectIdSchema } from '@/lib/contracts';
import { connectSellerDb } from '@/lib/mongo';
import { Store } from '@/lib/services';
import { StorefrontHttpError, databaseUnavailable, storeNotFound } from '@/lib/storefront/errors';

/** What a store charges and accepts, read defensively from its Mixed settings. */
export interface StoreCommerce {
  id: string;
  deliveryRate: number;
  freeDeliveryThreshold: number | null;
  codEnabled: boolean;
  cardEnabled: boolean;
}

interface ActiveStoreRow {
  _id: unknown;
  status: string;
  storefront?: unknown;
  paymentSettings?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Whole rupees (D-004): a store's settings are not validated yet, so a decimal is rounded where it is read. */
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Same defaults as the store DTO: cash on delivery is on unless turned off, card only when enabled. */
export function readStoreCommerce(row: ActiveStoreRow): StoreCommerce {
  const sf = record(row.storefront);
  const pay = record(row.paymentSettings);
  return {
    id: String(row._id),
    deliveryRate: amount(sf.deliveryRate) ?? 0,
    freeDeliveryThreshold: amount(sf.freeDeliveryThreshold),
    codEnabled: pay.codEnabled !== false,
    cardEnabled: pay.cardEnabled === true,
  };
}

/** A malformed id can never be a store. Cheap, so a route can run it before the rate limiter and the database. */
export function assertStoreId(id: string): void {
  if (!objectIdSchema.safeParse(id).success) throw storeNotFound();
}

/**
 * Resolves the :id of a storefront route to an active store, or throws.
 *   404 STORE_NOT_FOUND   malformed or unknown id (a malformed id never reaches the database)
 *   403 STORE_NOT_ACTIVE  the store exists but is not serving
 *   503 STOREFRONT_UNAVAILABLE  the database is down
 */
export async function loadActiveStore(id: string): Promise<StoreCommerce> {
  assertStoreId(id);

  await connectSellerDb().catch(() => {
    throw databaseUnavailable();
  });

  const store = (await (Store as any).findById(id).select('status storefront paymentSettings').lean()) as ActiveStoreRow | null;
  if (!store) throw storeNotFound();
  if (store.status !== 'active') {
    throw new StorefrontHttpError(403, 'STORE_NOT_ACTIVE', 'This store is not available.', { status: store.status });
  }
  return readStoreCommerce({ ...store, _id: store._id ?? id });
}
