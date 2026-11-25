import { HttpError } from '@/lib/http';
import { SELLER_ALERT_KINDS } from '@/lib/contracts';
import { connectSellerDb } from '@/lib/mongo';
import { SellerAlert } from '@/lib/services';

/** Shared by the /api/alerts routes (EP-07.US03.T01). Every query names the verified store. */

export async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

const iso = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value !== '' ? value : null;
};

// The kinds the bell can show: the contracts list (which the model repeats). A stored kind outside it is read as new_order, so a kind added
// to the model but not to the contracts would silently turn into new_order: test/seller-alert-kinds.test.ts fails when the lists differ.
const KINDS = SELLER_ALERT_KINDS;

/** An alert as the dashboard receives it (sellerAlertSchema): no store, key or bookkeeping fields. */
export function toAlertWire(doc: unknown): {
  id: string;
  kind: (typeof KINDS)[number];
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
} {
  const row = (doc ?? {}) as Record<string, unknown>;
  const kind = (KINDS as readonly string[]).includes(String(row.kind)) ? (row.kind as (typeof KINDS)[number]) : 'new_order';
  return {
    id: String(row._id ?? ''),
    kind,
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : '',
    link: typeof row.link === 'string' && row.link.startsWith('/') ? row.link : null,
    readAt: iso(row.readAt),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Sprint 8 (S8-B3, D-118): the bell shows each person the alerts their role can act on. The owner and a manager see every alert. Staff see the order and stock alerts (new order, unconfirmed
 * order, low stock, out of stock). Support sees the new order (to view it), the return request, the review and the contact message. An alert of another kind is not in their list, count or
 * read-all, and its id is a 404 for them. (An alert row belongs to the store, so reading it marks it read for everyone: the read state is the store's.)
 */
export const ALERT_KINDS_BY_ROLE: Readonly<Record<string, readonly string[] | null>> = Object.freeze({
  owner: null,
  manager: null,
  staff: ['new_order', 'unconfirmed_order', 'low_stock', 'out_of_stock'],
  support: ['new_order', 'return_requested', 'review_received', 'contact_message'],
});

/** The kinds a role may see: null for all of them, [] for an unknown or missing role (it sees none: fail closed). */
export function alertKindsFor(role: unknown): readonly string[] | null {
  if (typeof role !== 'string' || !(role in ALERT_KINDS_BY_ROLE)) return [];
  return ALERT_KINDS_BY_ROLE[role] ?? null;
}

/** The query of the alerts a role may see in a store (the store alone for the owner and a manager: the same query as before). */
export function alertFilterFor(storeId: string, role: unknown): Record<string, unknown> {
  const kinds = alertKindsFor(role);
  return kinds === null ? { store: storeId } : { store: storeId, kind: { $in: [...kinds] } };
}

export async function unreadCount(storeId: string, role: unknown = 'owner'): Promise<number> {
  return SellerAlert.countDocuments({ ...alertFilterFor(storeId, role), readAt: null });
}

export const NO_STORE = { 'Cache-Control': 'no-store' };
