/*
 * Sprint 5 EP-13.US01 / US03 (D-107, D-108, D-109): the arithmetic of returns, as small pure functions. Everything is WHOLE RUPEES, computed
 * with integer arithmetic and Math.round on a single division, never a float carried between steps. No database, no clock but the one passed in.
 *
 *   returned base      = the price of the returned quantities less their share of the order's discount, delivery excluded (D-089)
 *   commission reversal = round(original commission x returned base / order commission base), ONE per return; the reversals of an order
 *                         never add up to more than the original commission, and the last one takes the remainder.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

/** The item total of some lines: price times quantity, summed. */
export function grossOf(lines: ReadonlyArray<PricedLine>): number {
  return lines.reduce((sum, line) => sum + whole(line.unitPrice) * whole(line.quantity), 0);
}

/**
 * The part of the order's discount that belongs to `gross` of the order's `subtotal`: round(discount x gross / subtotal). Returning the whole
 * order (gross = subtotal) gives the whole discount, so a full return and a sum of partial ones both end on the order's own base.
 */
export function discountShare(discount: number, subtotal: number, gross: number): number {
  const d = whole(discount);
  const s = whole(subtotal);
  if (s <= 0 || d <= 0) return 0;
  const g = Math.min(whole(gross), s);
  return Math.min(d, Math.round((d * g) / s));
}

/** The returned base of some returned lines: their price less their discount share, never below 0. */
export function returnedBase(lines: ReadonlyArray<PricedLine>, order: { subtotal: number; discountAmount: number }): number {
  const gross = grossOf(lines);
  return Math.max(0, gross - discountShare(order.discountAmount, order.subtotal, gross));
}

export interface ReversalInput {
  /** The original commission in whole rupees (positive): -balanceEffect of the cod_commission entry. */
  commission: number;
  /** The base that commission was taken on (the entry's baseAmount). */
  orderBase: number;
  /** The returned base of THIS return. */
  returnedBase: number;
  /** The returned bases already reversed by earlier returns of the order. */
  previousBase: number;
  /** What earlier reversals already gave back (positive). */
  previousAmount: number;
}

/**
 * The commission this return gives back, in whole rupees. Proportional, rounded to the rupee; when this return brings the order's returned
 * base up to its commission base (everything is back) it takes whatever remains of the commission, so the parts add up to exactly the
 * original; it is never more than what is left of the original commission.
 */
export function commissionReversal(input: ReversalInput): number {
  const commission = whole(input.commission);
  const base = whole(input.orderBase);
  const previousAmount = Math.min(commission, whole(input.previousAmount));
  const left = commission - previousAmount;
  if (commission <= 0 || base <= 0 || left <= 0) return 0;
  const room = Math.max(0, base - whole(input.previousBase));
  const returned = Math.min(whole(input.returnedBase), room);
  if (returned <= 0) return 0;
  if (whole(input.previousBase) + returned >= base) return left;
  return Math.min(left, Math.round((commission * returned) / base));
}

export type WindowState = 'open' | 'closed' | 'not_delivered' | 'returns_off';

/**
 * The return window of a delivered order: it opens when the order is delivered and runs windowDays days. 0 days means the store takes no
 * returns. The moment `deliveredAt + windowDays` itself is still inside.
 */
export function returnWindow(deliveredAt: Date | null, windowDays: number, now: Date): { state: WindowState; endsAt: Date | null } {
  const days = Math.max(0, Math.floor(Number.isFinite(windowDays) ? windowDays : 0));
  if (days === 0) return { state: 'returns_off', endsAt: null };
  if (deliveredAt === null || Number.isNaN(deliveredAt.getTime())) return { state: 'not_delivered', endsAt: null };
  const endsAt = new Date(deliveredAt.getTime() + days * DAY_MS);
  return { state: now.getTime() <= endsAt.getTime() ? 'open' : 'closed', endsAt };
}

export interface OrderLineQty {
  productId: string;
  variantId: string;
  quantity: number;
}

const keyOf = (line: { productId: string; variantId: string }): string => String(line.productId).toLowerCase() + '|' + String(line.variantId).toLowerCase();

/**
 * How many of each delivered line can still be asked for: delivered minus what earlier returns of the order already ask for. A rejected
 * return does not count (the caller passes only the returns that do). Never below 0.
 */
export function returnableQuantities(delivered: ReadonlyArray<OrderLineQty>, requested: ReadonlyArray<OrderLineQty>): Map<string, number> {
  const asked = new Map<string, number>();
  for (const line of requested) asked.set(keyOf(line), (asked.get(keyOf(line)) ?? 0) + whole(line.quantity));
  const out = new Map<string, number>();
  for (const line of delivered) out.set(keyOf(line), Math.max(0, (out.get(keyOf(line)) ?? 0) + whole(line.quantity) - 0));
  for (const [key, delivery] of out) out.set(key, Math.max(0, delivery - (asked.get(key) ?? 0)));
  return out;
}

export const returnLineKey = keyOf;

/**
 * True when every delivered quantity of the order has been received back across its returns: the order may then move delivered -> returned.
 * `received` are the received quantities of the returns that were received (restocked or not).
 */
export function everythingReceived(delivered: ReadonlyArray<OrderLineQty>, received: ReadonlyArray<OrderLineQty>): boolean {
  if (delivered.length === 0) return false;
  const back = new Map<string, number>();
  for (const line of received) back.set(keyOf(line), (back.get(keyOf(line)) ?? 0) + whole(line.quantity));
  const need = new Map<string, number>();
  for (const line of delivered) need.set(keyOf(line), (need.get(keyOf(line)) ?? 0) + whole(line.quantity));
  for (const [key, quantity] of need) if ((back.get(key) ?? 0) < quantity) return false;
  return true;
}

/** What may still be refunded on a return: the cap less what is already recorded. Never below 0. */
export function refundRoom(cap: number, recorded: number): number {
  return Math.max(0, whole(cap) - whole(recorded));
}
