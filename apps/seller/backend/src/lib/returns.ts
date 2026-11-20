import { randomInt } from 'node:crypto';
import type { ReturnItemView, ReturnReceivedView, ReturnRefundView, SellerReturn } from '@markaz/contracts';
import { grossOf, returnLineKey, returnedBase } from '@/lib/contracts';
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
 */
export function refundCapOf(returnDoc: unknown, order: unknown): number | null {
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
  return returnedBase(lines, { subtotal: whole(o.subtotal), discountAmount: whole(o.discountAmount) });
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
