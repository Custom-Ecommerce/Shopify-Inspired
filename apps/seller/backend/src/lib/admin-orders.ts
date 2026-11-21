import type { AdminOrderDetail, AdminOrderList, AdminOrderRow } from '@markaz/contracts';
import { HttpError } from '@/lib/http';
import { Order, Store, assertCan } from '@/lib/services';
import { escapeRegex } from '@/lib/storefront/product-query';

/**
 * Sprint 6 EP-12 (S6-B5, D-093): the admin's READ-ONLY view of orders, behind the signed internal routes. SAFE fields only: the rows are built
 * field by field (an allowlist), and the query SELECTS only the safe fields, so a phone, an address, an email or a name is never even read from
 * the database. Money is whole rupees. The admin policy row is adminOrdersView (the old orders row is not used here).
 */

const LIST_FIELDS = 'store orderId status paymentMethod total city items createdAt updatedAt';
const DETAIL_FIELDS = LIST_FIELDS + ' subtotal deliveryCharges discountAmount statusHistory paymentStatus confirmationStatus';
const DAY_MS = 86_400_000;

type Doc = Record<string, any>;
const iso = (value: unknown): string => new Date((value as string) || 0).toISOString();
const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

export interface OrderListFilters {
  store?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  page: number;
  limit: number;
}

/** The query. Dates are UTC days; `to` is inclusive. A search is an anchored prefix of the order number (never a scan of other fields). */
export function orderFilter(filters: Omit<OrderListFilters, 'page' | 'limit'>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (filters.store) filter.store = filters.store;
  if (filters.status) filter.status = filters.status;
  const range: Record<string, Date> = {};
  if (filters.from) range.$gte = new Date(filters.from + 'T00:00:00.000Z');
  if (filters.to) range.$lt = new Date(new Date(filters.to + 'T00:00:00.000Z').getTime() + DAY_MS);
  if (Object.keys(range).length > 0) filter.createdAt = range;
  if (filters.q) filter.orderId = { $regex: '^' + escapeRegex(filters.q), $options: 'i' };
  return filter;
}

export function toOrderRow(doc: Doc, storeName: string | null): AdminOrderRow {
  return {
    id: String(doc._id),
    orderNumber: String(doc.orderId ?? ''),
    storeId: String(doc.store),
    storeName,
    status: doc.status,
    paymentMethod: doc.paymentMethod === 'cod' || doc.paymentMethod === 'card' ? doc.paymentMethod : null,
    total: whole(doc.total),
    city: typeof doc.city === 'string' && doc.city !== '' ? doc.city : null,
    itemCount: Array.isArray(doc.items) ? doc.items.reduce((sum: number, line: Doc) => sum + whole(line?.quantity), 0) : 0,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

async function storeNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const stores = (await Store.find({ _id: { $in: unique } } as never).select('name').lean()) as unknown as Array<{ _id: unknown; name?: string }>;
  return new Map(stores.map((store) => [String(store._id), store.name ?? '']));
}

/** POST /api/internal/orders: a page of orders across stores, newest first, safe fields only. */
export async function listAdminOrders(filters: OrderListFilters): Promise<AdminOrderList> {
  assertCan('admin', 'read', 'adminOrdersView', ['orderNumber', 'store', 'status', 'paymentMethod', 'total', 'city', 'createdAt', 'updatedAt', 'itemCount']);
  const filter = orderFilter(filters);
  const [rows, totalDocs] = await Promise.all([
    Order.find(filter as never)
      .select(LIST_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .lean() as unknown as Promise<Doc[]>,
    Order.countDocuments(filter as never),
  ]);
  const names = await storeNames(rows.map((row) => String(row.store)));
  return {
    docs: rows.map((row) => toOrderRow(row, names.get(String(row.store)) ?? null)),
    page: filters.page,
    limit: filters.limit,
    totalDocs,
    totalPages: Math.ceil(totalDocs / filters.limit),
  };
}

/** POST /api/internal/orders/detail { orderId }: items, totals, status history, payment and confirmation state. Still no name, phone, address or email. */
export async function readAdminOrder(orderId: string): Promise<{ order: AdminOrderDetail }> {
  assertCan('admin', 'read', 'adminOrdersView', ['orderNumber', 'items', 'totals', 'statusHistory', 'paymentStatus', 'confirmationStatus']);
  const doc = (await Order.findOne({ _id: orderId } as never).select(DETAIL_FIELDS).lean()) as unknown as Doc | null;
  if (!doc) throw new HttpError(404, 'Order not found');
  const name = (await storeNames([String(doc.store)])).get(String(doc.store)) ?? null;
  const items = (Array.isArray(doc.items) ? doc.items : []).map((line: Doc) => {
    const variant = typeof line.variantTitle === 'string' && line.variantTitle !== '' && line.variantTitle !== 'Default' ? ' (' + line.variantTitle + ')' : '';
    const quantity = Math.max(1, whole(line.quantity));
    return { name: String(line.productTitle ?? '') + variant, quantity, unitPrice: whole(line.unitPrice), lineTotal: whole(line.unitPrice) * quantity };
  });
  const history = (Array.isArray(doc.statusHistory) ? doc.statusHistory : [])
    .filter((entry: Doc) => entry && (entry.kind === undefined || entry.kind === 'status'))
    .map((entry: Doc) => ({ from: entry.from, to: entry.to, at: iso(entry.at) }));
  return {
    order: {
      ...toOrderRow(doc, name),
      items,
      totals: { subtotal: whole(doc.subtotal), discount: whole(doc.discountAmount), delivery: whole(doc.deliveryCharges), total: whole(doc.total) },
      statusHistory: history,
      paymentStatus: doc.paymentStatus ?? 'unpaid',
      confirmationStatus: doc.confirmationStatus ?? 'not_required',
    },
  };
}
