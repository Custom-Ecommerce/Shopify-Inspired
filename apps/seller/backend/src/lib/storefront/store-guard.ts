import { objectIdSchema } from '@/lib/contracts';
import { connectSellerDb } from '@/lib/mongo';
import { Store } from '@/lib/services';
import { cardPaymentsAvailable } from '@/lib/storefront/card-config';
import { StorefrontHttpError, databaseUnavailable, storeNotFound } from '@/lib/storefront/errors';
import { cityRateMap, readDelivery, readPayments } from '@/lib/store-settings';

/** What a store charges and accepts, read defensively from its Mixed settings. */
export interface StoreCommerce {
  id: string;
  deliveryRate: number;
  freeDeliveryThreshold: number | null;
  codEnabled: boolean;
  cardEnabled: boolean;
  /** Sprint 4 EP-04.US02: the store's rate per city (cityKey -> rupees). */
  cityRates: Readonly<Record<string, number>>;
  /** The shipping city of a quote or an order, set by the caller. */
  city?: string | null;
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

/**
 * Same defaults as the store DTO: cash on delivery is on unless turned off. Card (Sprint 4 EP-04.US03, D-094) is offered
 * only when the platform's Stripe keys exist AND the store has not switched card off (a store that never saved the
 * switch keeps today's behaviour: on with the keys).
 */
export function readStoreCommerce(row: ActiveStoreRow): StoreCommerce {
  const delivery = readDelivery(row.storefront);
  const payments = readPayments(row.paymentSettings);
  return {
    id: String(row._id),
    deliveryRate: delivery.defaultRate,
    freeDeliveryThreshold: delivery.freeOver,
    codEnabled: payments.codEnabled,
    cardEnabled: cardPaymentsAvailable() && payments.cardEnabled,
    cityRates: cityRateMap(delivery),
  };
}

/** A malformed id can never be a store. Cheap, so a route can run it before the rate limiter and the database. */
export function assertStoreId(id: string): void {
  if (!objectIdSchema.safeParse(id).success) throw storeNotFound();
}

/** Does a store in this state serve this request? A pending store serves its owner's preview (A-012); nothing else changes. */
export function servesStore(status: string, preview: boolean): boolean {
  return status === 'active' || (preview && status === 'pending');
}

/**
 * Resolves the :id of a storefront route to an active store, or throws. With preview set, a pending store resolves too.
 *   404 STORE_NOT_FOUND   malformed or unknown id (a malformed id never reaches the database)
 *   403 STORE_NOT_ACTIVE  the store exists but is not serving
 *   503 STOREFRONT_UNAVAILABLE  the database is down
 */
export async function loadActiveStore(id: string, options: { preview?: boolean } = {}): Promise<StoreCommerce> {
  assertStoreId(id);

  await connectSellerDb().catch(() => {
    throw databaseUnavailable();
  });

  const store = (await Store.findById(id).select('status storefront paymentSettings').lean()) as unknown as ActiveStoreRow | null;
  if (!store) throw storeNotFound();
  if (!servesStore(store.status, options.preview === true)) {
    throw new StorefrontHttpError(403, 'STORE_NOT_ACTIVE', 'This store is not available.', { status: store.status });
  }
  return readStoreCommerce({ ...store, _id: store._id ?? id });
}
