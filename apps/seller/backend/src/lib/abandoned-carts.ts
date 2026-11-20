import type { AbandonedCartItemView, AbandonedCartList, AbandonedCartRequest, SellerAbandonedCart } from '@markaz/contracts';
import { ABANDONED_CART_TTL_DAYS } from '@/lib/contracts';
import { isDuplicateKeyError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { databaseReady } from '@/lib/notifications';
import { AbandonedCart, assertCan } from '@/lib/services';
import { loadCartQuote } from '@/lib/storefront/cart-quote-service';
import { parseCartQuoteRequest } from '@/lib/storefront/cart-request';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import type { StoreCommerce } from '@/lib/storefront/store-guard';

/*
 * Sprint 5 EP-28.US01 (D-107): abandoned carts, WhatsApp first. The checkout saves a cart once the shopper typed a valid phone and was shown the
 * consent line. The server prices the lines itself from the product ids (a price or a total in the request is never read), keeps ONE open
 * cart per store and phone, and lets it expire 7 days after the last activity. An order with the same phone key marks it recovered.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : {});
const DAY_MS = 86_400_000;

/** The statuses a cart can still be refreshed in: the shopper is still deciding, or the seller already reached out. */
export const LIVE_CART_STATUSES = ['open', 'contacted'] as const;

const asDate = (value: unknown): Date | null => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date : null;
};
const iso = (value: unknown): string | null => asDate(value)?.toISOString() ?? null;

// -------------------------------------------------------------------------------------------------------------------------- pricing

export interface PricedCartItems {
  items: Array<{ productId: string; variantId: string; productTitle: string; variantTitle: string; quantity: number; unitPrice: number }>;
  /** The value of the items in whole rupees, delivery not included. */
  total: number;
}

/**
 * Prices a cart from the catalog (the cart quote's own pricing): the lines that can be bought, with the server's names and unit prices. The
 * browser sends product ids, variant ids and quantities only. A cart with nothing buyable is refused with 400, so nothing empty is stored.
 */
export async function priceCartItems(storeId: string, store: StoreCommerce, request: Pick<AbandonedCartRequest, 'lines'>): Promise<PricedCartItems> {
  const parsed = parseCartQuoteRequest({ lines: request.lines });
  const quote = await loadCartQuote(storeId, { ...store, city: null }, parsed.lines, null);
  const items: PricedCartItems['items'] = [];
  for (const line of quote.lines) {
    if (line.issue !== null || line.unitPrice === null || line.variantId === null) continue;
    items.push({
      productId: line.productId,
      variantId: line.variantId,
      productTitle: (line.title ?? '').slice(0, 200),
      variantTitle: (line.variantTitle ?? '').slice(0, 200),
      quantity: line.qty,
      unitPrice: Math.max(0, Math.round(line.unitPrice)),
    });
  }
  if (items.length === 0) throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'lines: none of these items can be bought.', { field: 'lines' });
  return { items, total: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) };
}

// ---------------------------------------------------------------------------------------------------------------------------- saving

const CREATE_FIELDS = ['store', 'phone', 'email', 'items', 'total', 'status', 'consentAt', 'lastSeenAt', 'expiresAt'];
const REFRESH_FIELDS = ['email', 'items', 'total', 'lastSeenAt', 'expiresAt'];

export type SaveOutcome = 'created' | 'refreshed';

/**
 * Keeps the cart: refreshes the store's open (or contacted) cart of this phone, or creates one. Two parallel first requests both try to
 * create: the partial unique index { store, phone } (status open) lets one win, and the other refreshes what the winner made. The phone is
 * already normalized by the contract (+923xxxxxxxxx) and consent is already checked by it (consent must be literally true).
 */
export async function saveAbandonedCart(storeId: string, store: StoreCommerce, request: AbandonedCartRequest, now: Date = new Date()): Promise<SaveOutcome> {
  const priced = await priceCartItems(storeId, store, request);
  const expiresAt = new Date(now.getTime() + ABANDONED_CART_TTL_DAYS * DAY_MS);
  const items = priced.items.map((item) => ({ ...item, productId: oid(item.productId) }));
  const base = { items, total: priced.total, lastSeenAt: now, expiresAt };
  const refresh = { ...base, ...(request.email === null ? {} : { email: request.email }) };

  const refreshExisting = async (): Promise<boolean> => {
    assertCan('system', 'update', 'abandonedCarts', REFRESH_FIELDS);
    const updated = await AbandonedCart.findOneAndUpdate(
      { store: oid(storeId), phone: request.phone, status: { $in: [...LIVE_CART_STATUSES] } },
      { $set: refresh },
      { new: true },
    ).lean();
    return updated !== null;
  };

  if (await refreshExisting()) return 'refreshed';
  assertCan('system', 'create', 'abandonedCarts', CREATE_FIELDS);
  try {
    await AbandonedCart.create({ store: oid(storeId), phone: request.phone, email: request.email, ...base, status: 'open', consentAt: now });
    return 'created';
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // A parallel request created the open cart first: this one refreshes it.
    await refreshExisting();
    return 'refreshed';
  }
}

// ------------------------------------------------------------------------------------------------------------------------ recovered

/**
 * An order was placed: the open (or contacted) cart of the same phone key is recovered, with the order id, in the same request. Best effort
 * (a failure is logged and never fails the order) and skipped while no database connection is open. Returns how many carts it marked.
 */
export async function markCartRecovered(storeId: string, phoneKey: string | null | undefined, orderId: unknown, now: Date = new Date()): Promise<number> {
  if (typeof phoneKey !== 'string' || !phoneKey.startsWith('+') || !databaseReady()) return 0;
  try {
    assertCan('system', 'update', 'abandonedCarts', ['status', 'recoveredOrder', 'recoveredAt']);
    const result = (await AbandonedCart.updateMany(
      { store: oid(storeId), phone: phoneKey, status: { $in: [...LIVE_CART_STATUSES] } },
      { $set: { status: 'recovered', recoveredOrder: orderId, recoveredAt: now } },
    )) as unknown as { modifiedCount?: number };
    return result.modifiedCount ?? 0;
  } catch (err) {
    console.error('[seller-backend] could not mark an abandoned cart recovered', err instanceof Error ? err.name : 'unknown');
    return 0;
  }
}

// ----------------------------------------------------------------------------------------------------------------------- the seller

export function toSellerCart(doc: unknown): SellerAbandonedCart {
  const row = record(doc);
  const items: AbandonedCartItemView[] = (Array.isArray(row.items) ? (row.items as unknown[]) : []).map((raw) => {
    const item = record(raw);
    return {
      productId: String(item.productId ?? ''),
      variantId: String(item.variantId ?? ''),
      productTitle: typeof item.productTitle === 'string' ? item.productTitle : '',
      variantTitle: typeof item.variantTitle === 'string' ? item.variantTitle : '',
      quantity: Math.round(Number(item.quantity) || 0),
      unitPrice: Math.round(Number(item.unitPrice) || 0),
    };
  });
  const status = row.status === 'contacted' || row.status === 'recovered' || row.status === 'expired' ? row.status : 'open';
  return {
    id: String(row._id ?? ''),
    phone: typeof row.phone === 'string' ? row.phone : '',
    email: typeof row.email === 'string' && row.email !== '' ? row.email : null,
    items,
    total: Math.round(Number(row.total) || 0),
    status,
    lastSeenAt: iso(row.lastSeenAt) ?? new Date(0).toISOString(),
    contactedAt: iso(row.contactedAt),
    recoveredOrder: row.recoveredOrder === null || row.recoveredOrder === undefined ? null : String(row.recoveredOrder),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/** The store's carts, newest activity first. A cart past its expiry is not listed even before the TTL job deletes it. */
export async function listCarts(storeId: string, query: { status?: 'open' | 'contacted' | 'recovered'; page: number; limit: number }, now: Date = new Date()): Promise<AbandonedCartList> {
  const live = { store: oid(storeId), expiresAt: { $gt: now } };
  const filter = query.status === undefined ? live : { ...live, status: query.status };
  const [rows, totalDocs, openCount] = await Promise.all([
    AbandonedCart.find(filter)
      .sort({ lastSeenAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<Row[]>,
    AbandonedCart.countDocuments(filter),
    countOpenCarts(storeId, now),
  ]);
  return { docs: rows.map(toSellerCart), page: query.page, limit: query.limit, totalDocs, totalPages: Math.ceil(totalDocs / query.limit), openCount };
}

/** The dashboard count: the store's open carts that have not expired. */
export async function countOpenCarts(storeId: string, now: Date = new Date()): Promise<number> {
  return AbandonedCart.countDocuments({ store: oid(storeId), status: 'open', expiresAt: { $gt: now } });
}
