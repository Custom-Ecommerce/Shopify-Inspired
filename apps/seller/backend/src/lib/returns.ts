import { randomInt } from 'node:crypto';
import type { ReturnItemView, ReturnReceivedView, ReturnRefundView, SellerReturn } from '@markaz/contracts';
import { everythingReceived, grossOf, returnLineKey, returnedBase } from '@/lib/contracts';
import { oid } from '@/lib/ledger-aggregates';
import { Return } from '@/lib/services';

/*
 * Sprint 5 EP-13 (D-107, D-108, D-109): the small shared pieces of returns: the delivered date, the return number, the customer's returns
 * count (one helper for the customer page and the repeat_returns risk rule), the refund cap and the seller's view of a return.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : {});
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);
const asDate = (value: unknown): Date | null => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date : null;
};
const iso = (value: unknown): string | null => asDate(value)?.toISOString() ?? null;

// ----------------------------------------------------------------------------------------------------------- the delivered date

/**
 * When an order was delivered: the last statusHistory entry that moved it to delivered (D-108: there is no Order.deliveredAt field and no
 * migration). Null when the order has no such entry (it was never delivered). The ONE place the delivered date is read.
 */
export function deliveredAtOf(order: unknown): Date | null {
  const history = record(order).statusHistory;
  let latest: Date | null = null;
  for (const entry of Array.isArray(history) ? history : []) {
    const row = record(entry);
    if (row.to !== 'delivered') continue;
    const at = asDate(row.at);
    if (at !== null && (latest === null || at.getTime() >= latest.getTime())) latest = at;
  }
  return latest;
}

// ----------------------------------------------------------------------------------------------------------- return numbers

// No 0/O or 1/I/L: a number is read aloud and typed from a phone screen (the same alphabet as order ids).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A human-facing return number such as RET-7KQ4M2XA, drawn from a CSPRNG. Unique per store (the unique index decides a collision). */
export function generateReturnNumber(): string {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += ALPHABET.charAt(randomInt(ALPHABET.length));
  return 'RET-' + out;
}

// -------------------------------------------------------------------------------------------------------- the returns count

/**
 * How many returns this customer has in this store: the returns that were not rejected, by the shopper's normalized phone (the same
 * phoneKey the customers are grouped by). 0 for a customer with no phone key. The ONE helper behind the customer page's returns count
 * and the repeat_returns risk rule (SB-3 makes real what SB-1 and SB-2 left as a placeholder).
 */
export async function returnsCountFor(storeId: string, phoneKey: string | null | undefined): Promise<number> {
  if (typeof phoneKey !== 'string' || !phoneKey.startsWith('+')) return 0;
  return Return.countDocuments({ store: oid(storeId), contactPhone: phoneKey, status: { $ne: 'rejected' } });
}

// -------------------------------------------------------------------------------------------------------------------- lines

export interface OrderLineRow {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  unitPrice: number;
  quantity: number;
}

/** The lines of a stored order, as plain rows. A line is productId + variantId. */
export function orderLinesOf(order: unknown): OrderLineRow[] {
  const items = record(order).items;
  return (Array.isArray(items) ? items : []).map((raw) => {
    const item = record(raw);
    return {
      productId: String(item.productId ?? ''),
      variantId: String(item.variantId ?? ''),
      productTitle: String(item.productTitle ?? ''),
      variantTitle: String(item.variantTitle ?? ''),
      unitPrice: whole(item.unitPrice),
      quantity: whole(item.quantity),
    };
  });
}

/**
 * The most that can be refunded on a return: the paid value of the quantities that came back (their price less their share of the order's
 * discount, delivery excluded), priced with the return's own line prices. Null until the return has been received.
 *
 * earlierBase (SB-6, verification bug 6) is given only for the return that COMPLETES the received quantities of the whole order
 * (see completionOf): its base is then the order's own base (subtotal less discount) minus what the earlier returns took, so the caps of all
 * the returns of an order add up to the order base exactly, however the discount share rounded in each part.
 */
export function refundCapOf(returnDoc: unknown, order: unknown, earlierBase: number | null = null): number | null {
  const doc = record(returnDoc);
  const received = Array.isArray(doc.received) ? (doc.received as unknown[]).map(record) : [];
  if (received.length === 0) return null;
  const items = Array.isArray(doc.items) ? (doc.items as unknown[]).map(record) : [];
  const price = new Map(items.map((item) => [returnLineKey({ productId: String(item.productId), variantId: String(item.variantId) }), whole(item.unitPrice)]));
  const lines = received.map((entry) => ({
    unitPrice: price.get(returnLineKey({ productId: String(entry.productId), variantId: String(entry.variantId) })) ?? 0,
    quantity: whole(entry.quantity),
  }));
  const o = record(order);
  if (earlierBase !== null) return Math.max(0, whole(o.subtotal) - whole(o.discountAmount) - Math.max(0, whole(earlierBase)));
  return returnedBase(lines, { subtotal: whole(o.subtotal), discountAmount: whole(o.discountAmount) });
}

const COUNTED_STATUSES = new Set(['received', 'refunded']);

/** When a return was received: receivedAt, else (a return from before SB-6) its last update, else its request. */
function receivedKey(doc: Row): number {
  return (asDate(doc.receivedAt) ?? asDate(doc.updatedAt) ?? asDate(doc.createdAt))?.getTime() ?? 0;
}

export interface ReturnCompletion {
  /** True when this return is the one whose receipt brought every delivered quantity of the order back (everythingReceived). */
  completes: boolean;
  /** The refund caps of the returns received before this one (their proportional caps): what the completing return's base subtracts. */
  earlierBase: number;
  /** The earlier received returns of the order with their proportional caps (SB-7: the completing return keeps back the share of those without a reversal). */
  earlier: Array<{ returnId: unknown; base: number }>;
}

/**
 * Whether a return is THE ONE that completes the received quantities of its whole order. The received (or refunded) returns of the order are
 * taken in the order they were received (receivedAt, then _id); the first one at which everythingReceived holds is the completing one, and a
 * later receipt cannot change that (nothing is left to return). siblings are the received or refunded returns of the same order (the
 * return itself may be among them: its own row wins). One rule for the refund, the view, the list and the reconcile.
 */
export function completionOf(returnDoc: unknown, siblings: readonly unknown[], order: unknown): ReturnCompletion {
  const doc = record(returnDoc);
  const mine = String(doc._id ?? '');
  const pool = new Map<string, Row>();
  for (const sibling of siblings) {
    const row = record(sibling);
    if (COUNTED_STATUSES.has(String(row.status))) pool.set(String(row._id), row);
  }
  if (COUNTED_STATUSES.has(String(doc.status))) pool.set(mine, doc);
  if (!pool.has(mine)) return { completes: false, earlierBase: 0, earlier: [] };
  const lines = orderLinesOf(order);
  const ordered = [...pool.values()].sort((a, b) => receivedKey(a) - receivedKey(b) || String(a._id).localeCompare(String(b._id)));
  const back: Array<{ productId: string; variantId: string; quantity: number }> = [];
  let earlierBase = 0;
  const earlier: Array<{ returnId: unknown; base: number }> = [];
  for (const row of ordered) {
    for (const entry of Array.isArray(row.received) ? (row.received as unknown[]).map(record) : []) {
      back.push({ productId: String(entry.productId), variantId: String(entry.variantId), quantity: whole(entry.quantity) });
    }
    const complete = everythingReceived(lines, back);
    if (String(row._id) === mine) return { completes: complete, earlierBase, earlier };
    if (complete) return { completes: false, earlierBase, earlier };
    const base = refundCapOf(row, order) ?? 0;
    earlierBase += base;
    earlier.push({ returnId: row._id, base });
  }
  return { completes: false, earlierBase, earlier };
}

/** The refund cap of a return with the rule of the whole order applied: the same number in the refund, the detail, the list and the reconcile. */
export function refundCapFor(returnDoc: unknown, order: unknown, siblings: readonly unknown[]): number | null {
  if (!COUNTED_STATUSES.has(String(record(returnDoc).status))) return refundCapOf(returnDoc, order);
  const completion = completionOf(returnDoc, siblings, order);
  return refundCapOf(returnDoc, order, completion.completes ? completion.earlierBase : null);
}

/**
 * The refund cap of every return of one page (the seller's list), with ONE query for the received and refunded returns of the page's orders
 * (the completion rule needs a return's siblings). ordersById holds the page's orders, read once by the caller. Keyed by the return id.
 */
export async function refundCapsForPage(storeId: string, rows: readonly Row[], ordersById: ReadonlyMap<string, Row>): Promise<Map<string, number | null>> {
  const counted = rows.filter((row) => COUNTED_STATUSES.has(String(row.status)));
  const orderRefs = new Map<string, unknown>();
  for (const row of counted) orderRefs.set(String(row.order), row.order);
  const siblings =
    orderRefs.size === 0
      ? []
      : ((await Return.find({ store: oid(storeId), order: { $in: [...orderRefs.values()] }, status: { $in: [...COUNTED_STATUSES] } }).lean()) as unknown as Row[]);
  const byOrder = new Map<string, Row[]>();
  for (const sibling of siblings) byOrder.set(String(sibling.order), [...(byOrder.get(String(sibling.order)) ?? []), sibling]);
  const caps = new Map<string, number | null>();
  for (const row of rows) {
    const order = ordersById.get(String(row.order));
    caps.set(String(row._id), order ? refundCapFor(row, order, byOrder.get(String(row.order)) ?? []) : null);
  }
  return caps;
}

/** The gross price of the lines a return asks for (before any discount share): what the shopper sees as the value of the request. */
export function requestedGross(returnDoc: unknown): number {
  const items = record(returnDoc).items;
  return grossOf((Array.isArray(items) ? items : []).map((raw) => ({ unitPrice: whole(record(raw).unitPrice), quantity: whole(record(raw).quantity) })));
}

// --------------------------------------------------------------------------------------------------------- the seller's view

/**
 * One return as the seller reads it. Built field by field, so nothing else stored can reach the response. `extras` come from the order the
 * return belongs to (the route reads it): the payment method, the customer's name, and the refund cap.
 */
export function toSellerReturn(doc: unknown, extras: { paymentMethod?: string | null; customerName?: string | null; refundCap?: number | null } = {}): SellerReturn {
  const row = record(doc);
  const items: ReturnItemView[] = (Array.isArray(row.items) ? (row.items as unknown[]) : []).map((raw) => {
    const item = record(raw);
    return {
      productId: String(item.productId ?? ''),
      variantId: String(item.variantId ?? ''),
      productTitle: String(item.productTitle ?? ''),
      variantTitle: String(item.variantTitle ?? ''),
      quantity: whole(item.quantity),
      unitPrice: whole(item.unitPrice),
    };
  });
  const received: ReturnReceivedView[] = (Array.isArray(row.received) ? (row.received as unknown[]) : []).map((raw) => {
    const entry = record(raw);
    return { productId: String(entry.productId ?? ''), variantId: String(entry.variantId ?? ''), quantity: whole(entry.quantity), restock: entry.restock === true };
  });
  const refunds: ReturnRefundView[] = (Array.isArray(row.refunds) ? (row.refunds as unknown[]) : []).map((raw) => {
    const entry = record(raw);
    const method = entry.method === 'jazzcash' || entry.method === 'easypaisa' || entry.method === 'cash' ? entry.method : 'bank';
    return { amount: whole(entry.amount), method, reference: text(entry.reference), at: iso(entry.at) ?? new Date(0).toISOString(), by: entry.by === null || entry.by === undefined ? null : String(entry.by) };
  });
  const reason = text(row.reasonCode) ?? text(row.reason) ?? 'other';
  const createdAt = iso(row.createdAt) ?? new Date(0).toISOString();
  return {
    id: String(row._id ?? row.id ?? ''),
    returnNumber: text(row.returnNumber),
    orderId: String(row.order ?? ''),
    orderNumber: text(row.orderNumber),
    status: (['requested', 'approved', 'rejected', 'received', 'refunded', 'completed'].includes(String(row.status)) ? row.status : 'requested') as SellerReturn['status'],
    reasonCode: (['damaged', 'wrong_item', 'changed_mind', 'other'].includes(reason) ? reason : 'other') as SellerReturn['reasonCode'],
    note: text(row.description),
    rejectReason: text(row.rejectReason),
    contactPhone: text(row.contactPhone),
    customerName: extras.customerName ?? null,
    items,
    received,
    refunds,
    refundAmount: whole(row.refundAmount),
    refundCap: extras.refundCap ?? null,
    paymentMethod: extras.paymentMethod ?? null,
    createdAt,
    updatedAt: iso(row.updatedAt) ?? createdAt,
    resolvedAt: iso(row.resolvedAt),
  };
}

// ------------------------------------------------------------------------------------------------------------------ wa.me text

/**
 * The text of the seller's decision, English then Urdu, for the wa.me link the seller sends from their own phone (D-091: no API). Most
 * shoppers have no email, so this is how they hear. Pure; the dashboard builds the link with the customer's phone.
 */
export function returnDecisionText(
  decision: 'approved' | 'rejected',
  v: { storeName: string; customerName: string | null; returnNumber: string; orderNumber: string; reason?: string | null },
): string {
  const store = v.storeName.trim() || 'our store';
  const name = v.customerName?.trim() || 'there';
  if (decision === 'approved') {
    return (
      `Hi ${name}, ${store} approved your return ${v.returnNumber} for order ${v.orderNumber}. We will contact you about sending the items back.\n` +
      `السلام علیکم ${name}، ${store} نے آپ کے آرڈر ${v.orderNumber} کی واپسی ${v.returnNumber} منظور کر لی ہے۔ سامان واپس بھیجنے کے لیے ہم آپ سے رابطہ کریں گے۔`
    );
  }
  const reason = v.reason?.trim() || 'not stated';
  return (
    `Hi ${name}, ${store} could not approve your return ${v.returnNumber} for order ${v.orderNumber}. Reason: ${reason}\n` +
    `السلام علیکم ${name}، ${store} آپ کے آرڈر ${v.orderNumber} کی واپسی ${v.returnNumber} منظور نہیں کر سکا۔ وجہ: ${reason}`
  );
}
