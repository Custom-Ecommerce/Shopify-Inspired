import type { ReturnCreateRequest, ReturnEligibility, ReturnIneligibleReason, ReturnableLine } from '@markaz/contracts';
import { RETURN_REASON_LABELS, returnLineKey, returnWindow, returnableQuantities } from '@/lib/contracts';
import { isDuplicateKeyError } from '@/lib/http';
import { deliveredAtOf, generateReturnNumber, orderLinesOf, type OrderLineRow } from '@/lib/returns';
import { Order, Return, assertCan } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { matchOrderPhone } from '@/lib/storefront/order-phone';
import { normalizeOrderId } from '@/lib/storefront/order-id';

/*
 * Sprint 5 EP-13.US01.T03 (D-107, D-108): what the PUBLIC return routes do. The credential is the order number plus the phone (compared
 * through normalizePhoneE164, like the track route), NOT the 24 hour order-access token. A wrong phone, an unknown order and another store's
 * order all give the same 404. Only a delivered COD order inside the store's window can be returned, and only up to the quantities not yet
 * asked for. The seller backend acts as the `system` actor to create the return (the policy has create as system only).
 */

type Row = Record<string, unknown>;

export const returnNotFound = (): StorefrontHttpError => new StorefrontHttpError(404, 'ORDER_NOT_FOUND', 'No order matches those details.');

const notEligible = (message: string, extra: Record<string, unknown> = {}): StorefrontHttpError => new StorefrontHttpError(422, 'RETURN_NOT_ELIGIBLE', message, extra);

/** The words a shopper reads for each reason a return cannot be requested. */
export const INELIGIBLE_MESSAGES: Readonly<Record<ReturnIneligibleReason, string>> = {
  not_delivered: 'This order has not been delivered yet, so it cannot be returned.',
  window_closed: 'The return period for this order has ended.',
  returns_off: 'This store does not take returns.',
  card_order: 'Returns of card orders are not available yet. Please contact the store.',
  nothing_left: 'Every item of this order has already been returned or asked for.',
};

export interface ReturnableOrder {
  _id: unknown;
  orderId: string;
  status: string;
  paymentMethod: string;
  statusHistory: unknown;
  lines: OrderLineRow[];
  subtotal: number;
}

/**
 * The order of a number and a phone in this store, or the one 404. The phone on a stored order may be a local format, so it is normalised
 * before it is compared. Reads only what the return rules need.
 */
export async function loadReturnableOrder(storeId: string, orderNumber: string, phone: string): Promise<ReturnableOrder> {
  const row = (await Order.findOne({ store: storeId, orderId: normalizeOrderId(orderNumber) })
    .select('orderId status phone paymentMethod items subtotal statusHistory')
    .lean()) as unknown as Row | null;
  if (!row) throw returnNotFound();
  if (matchOrderPhone(row.phone, phone) === null) throw returnNotFound();
  return {
    _id: row._id,
    orderId: String(row.orderId ?? ''),
    status: String(row.status ?? ''),
    paymentMethod: String(row.paymentMethod ?? ''),
    statusHistory: row.statusHistory,
    lines: orderLinesOf(row),
    subtotal: typeof row.subtotal === 'number' ? row.subtotal : 0,
  };
}

/** The lines the order's earlier returns already ask for (a rejected return does not count). */
async function requestedBefore(storeId: string, orderId: unknown): Promise<Array<{ productId: string; variantId: string; quantity: number }>> {
  const rows = (await Return.find({ store: storeId, order: orderId, status: { $ne: 'rejected' } }).select('items').lean()) as unknown as Row[];
  const out: Array<{ productId: string; variantId: string; quantity: number }> = [];
  for (const row of rows) {
    for (const item of Array.isArray(row.items) ? (row.items as Row[]) : []) {
      out.push({ productId: String(item.productId), variantId: String(item.variantId), quantity: Number(item.quantity) || 0 });
    }
  }
  return out;
}

function stateOf(order: ReturnableOrder, windowDays: number, now: Date): { reason: ReturnIneligibleReason | null; deliveredAt: Date | null; endsAt: Date | null } {
  const deliveredAt = order.status === 'delivered' ? deliveredAtOf({ statusHistory: order.statusHistory }) : null;
  const window = returnWindow(deliveredAt, windowDays, now);
  let reason: ReturnIneligibleReason | null = null;
  if (window.state === 'returns_off') reason = 'returns_off';
  else if (order.paymentMethod === 'card') reason = 'card_order';
  else if (window.state === 'not_delivered') reason = 'not_delivered';
  else if (window.state === 'closed') reason = 'window_closed';
  return { reason, deliveredAt, endsAt: window.endsAt };
}

/** GET return-eligibility: what the shopper may still return, and the state of the window. No name, address or phone comes back. */
export async function eligibilityOf(storeId: string, order: ReturnableOrder, windowDays: number, now: Date = new Date()): Promise<ReturnEligibility> {
  const state = stateOf(order, windowDays, now);
  const left = returnableQuantities(order.lines, await requestedBefore(storeId, order._id));
  const lines: ReturnableLine[] = state.reason === null || state.reason === 'nothing_left'
    ? order.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        unitPrice: line.unitPrice,
        deliveredQuantity: line.quantity,
        returnableQuantity: left.get(returnLineKey(line)) ?? 0,
      }))
    : [];
  let reason = state.reason;
  if (reason === null && lines.every((line) => line.returnableQuantity === 0)) reason = 'nothing_left';
  return {
    eligible: reason === null,
    reason,
    windowDays,
    deliveredAt: state.deliveredAt?.toISOString() ?? null,
    windowEndsAt: state.endsAt?.toISOString() ?? null,
    lines: reason === null || reason === 'nothing_left' ? lines : [],
  };
}

/** What the system actor writes on a new return: every field the policy's create row for `system` allows. */
const CREATE_FIELDS = ['order', 'store', 'orderNumber', 'items', 'contactPhone', 'reason', 'reasonCode', 'description', 'status', 'returnNumber'];

const RETURN_NUMBER_ATTEMPTS = 5;

/** True when some line is asked for more times, across the order's returns, than it was delivered. (returnableQuantities clamps at 0, so this looks at the raw sums.) */
function overAsked(lines: OrderLineRow[], requested: Array<{ productId: string; variantId: string; quantity: number }>): boolean {
  const delivered = new Map<string, number>();
  for (const line of lines) delivered.set(returnLineKey(line), (delivered.get(returnLineKey(line)) ?? 0) + line.quantity);
  const asked = new Map<string, number>();
  for (const item of requested) asked.set(returnLineKey(item), (asked.get(returnLineKey(item)) ?? 0) + item.quantity);
  for (const [key, quantity] of asked) if (quantity > (delivered.get(key) ?? 0)) return true;
  return false;
}

/**
 * POST returns: checks the state, the lines and the quantities, then saves ONE return (several partial returns per order are allowed).
 * Two requests racing for the last unit are settled after the insert: the return that finds the order over-asked takes itself back.
 */
export async function createReturn(
  storeId: string,
  order: ReturnableOrder,
  windowDays: number,
  phone: string,
  request: ReturnCreateRequest,
  now: Date = new Date(),
): Promise<Row> {
  const state = stateOf(order, windowDays, now);
  if (state.reason !== null) throw notEligible(INELIGIBLE_MESSAGES[state.reason], { reason: state.reason });

  // The same line named twice is one line: the quantities add up.
  const wanted = new Map<string, { productId: string; variantId: string; quantity: number }>();
  for (const item of request.items) {
    const key = returnLineKey(item);
    const found = wanted.get(key);
    if (found) found.quantity += item.quantity;
    else wanted.set(key, { productId: item.productId, variantId: item.variantId, quantity: item.quantity });
  }
  const left = returnableQuantities(order.lines, await requestedBefore(storeId, order._id));
  const byKey = new Map(order.lines.map((line) => [returnLineKey(line), line]));
  const items: Array<{ productId: string; variantId: string; productTitle: string; variantTitle: string; quantity: number; unitPrice: number }> = [];
  for (const [key, item] of wanted) {
    const line = byKey.get(key);
    if (!line) throw notEligible('One of the items is not part of this order.', { reason: 'unknown_line', field: 'items' });
    const room = left.get(key) ?? 0;
    if (item.quantity > room) {
      throw notEligible(
        room === 0
          ? line.productTitle + ' has already been returned or asked for.'
          : 'You can return at most ' + room + ' of ' + line.productTitle + '.',
        { reason: 'quantity', field: 'items' },
      );
    }
    items.push({ productId: line.productId, variantId: line.variantId, productTitle: line.productTitle, variantTitle: line.variantTitle, quantity: item.quantity, unitPrice: line.unitPrice });
  }

  assertCan('system', 'create', 'returns', CREATE_FIELDS);
  let created: Row | null = null;
  for (let attempt = 1; created === null; attempt += 1) {
    try {
      created = (await Return.create({
        order: order._id,
        store: storeId,
        orderNumber: order.orderId,
        returnNumber: generateReturnNumber(),
        contactPhone: phone,
        items,
        reason: request.reasonCode,
        reasonCode: request.reasonCode,
        description: request.note,
        status: 'requested',
      })) as unknown as Row;
    } catch (err) {
      if (isDuplicateKeyError(err) && attempt < RETURN_NUMBER_ATTEMPTS) continue;
      throw err;
    }
  }

  // The race: another request may have asked for the same last unit between the check above and the insert. Count again, this return
  // included; if a line is now over-asked, this (the newer) return takes itself back and the shopper is told.
  if (overAsked(order.lines, await requestedBefore(storeId, order._id))) {
    await Return.deleteOne({ _id: created._id, store: storeId }).catch(() => undefined);
    throw notEligible('Some of these items were just asked for in another return. Please check what is left and try again.', { reason: 'quantity', field: 'items' });
  }
  return created;
}

/** The reason as the seller and the shopper read it. */
export const reasonLabel = (code: string): string => (RETURN_REASON_LABELS as Record<string, string>)[code] ?? code;
