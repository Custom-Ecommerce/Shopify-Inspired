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
  /**
   * SB-6 (verification bug 6): true when THIS return completes the received quantities of the whole order (everythingReceived, in the order the
   * returns were received). It is the last one: it takes everything that is left of the commission, whatever rounding the earlier parts made.
   */
  completesOrder?: boolean;
  /**
   * SB-7 (re-verification bug 2): with completesOrder, the proportional reversals (same rounding as a normal return) that the EARLIER received returns of the
   * order will still get because they have no reversal yet. The completing return keeps them back, so it takes only what is really left for it.
   */
  reservedForEarlier?: number;
}

/**
 * The commission this return gives back, in whole rupees. Proportional, rounded to the rupee; when this return brings the order's returned
 * base up to its commission base (everything is back) it takes whatever remains of the commission, so the parts add up to exactly the
 * original; it is never more than what is left of the original commission. A return that completesOrder (the received quantities of the whole
 * order are back with it) always takes what is left, so split returns add up exactly even when each part was rounded.
 */
export function commissionReversal(input: ReversalInput): number {
  const commission = whole(input.commission);
  const base = whole(input.orderBase);
  const previousAmount = Math.min(commission, whole(input.previousAmount));
  const left = commission - previousAmount;
  if (commission <= 0 || base <= 0 || left <= 0) return 0;
  if (input.completesOrder === true) return Math.max(0, left - whole(input.reservedForEarlier));
  const room = Math.max(0, base - whole(input.previousBase));
  const returned = Math.min(whole(input.returnedBase), room);
  if (returned <= 0) return 0;
  if (whole(input.previousBase) + returned >= base) return left;
  return Math.min(left, Math.round((commission * returned) / base));
}

export interface ReturnTaxInput {
  /** The order's tax snapshot: whole rupees (0 or absent when it had none) and how it was applied. */
  taxAmount: number | null | undefined;
  taxMode: string | null | undefined;
  /** The order's commission base: subtotal less discount (the amount the tax was worked out on; delivery is never in it). */
  orderBase: number;
  /** The returned bases (tax-free, as commissionReversal reads them) of the returns of this order that came before this one. */
  previousBase: number;
  /** The returned base of THIS return (tax-free). */
  returnedBase: number;
}

/**
 * Sprint 8 (S8-B1, D-118): the part of the tax the shopper paid that belongs to this return, in whole rupees, ADDED to the refund cap.
 *
 *   exclusive  the tax was added on top of the prices, so the shopper paid it: the return gets its proportional share of it
 *   inclusive  the prices already contain the tax, so the returned base already carries it: nothing is added (no double counting)
 *
 * Proportional and exact: the share is the difference of two running amounts, taxAmount x base / orderBase rounded half up, taken at the returned bases
 * before and after this return. The shares of all the returns of an order therefore add up to the tax paid, no rupee lost or created by rounding, and a
 * return that brings the returned base up to the order base takes whatever remains. The commission reversal and the commission base never see this: they
 * keep reading the tax-free base (D-089).
 */
export function returnTaxShare(input: ReturnTaxInput): number {
  const tax = whole(input.taxAmount);
  const base = whole(input.orderBase);
  if (tax <= 0 || base <= 0 || input.taxMode !== 'exclusive') return 0;
  const running = (returned: number): number => {
    const x = Math.min(whole(returned), base);
    return x >= base ? tax : Math.round((tax * x) / base);
  };
  const before = whole(input.previousBase);
  return Math.max(0, running(before + whole(input.returnedBase)) - running(before));
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
