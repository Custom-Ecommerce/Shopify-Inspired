import { HttpError } from '@/lib/http';
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

const KINDS = ['new_order', 'low_stock', 'out_of_stock'] as const;

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

export async function unreadCount(storeId: string): Promise<number> {
  return SellerAlert.countDocuments({ store: storeId, readAt: null });
}

export const NO_STORE = { 'Cache-Control': 'no-store' };
