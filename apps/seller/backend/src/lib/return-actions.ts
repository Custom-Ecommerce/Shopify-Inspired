import type { OrderStockRestore, ReturnReceiveRequest, ReturnRefundRequest, ReturnRejectRequest } from '@markaz/contracts';
import { CARD_REFUND_UNSUPPORTED, CARD_REFUND_UNSUPPORTED_MESSAGE, everythingReceived, refundRoom, returnLineKey } from '@/lib/contracts';
import { reverseForReturn, type ReturnReversalResult } from '@/lib/commission';
import { HttpError } from '@/lib/http';
import { notifyReturnDecision } from '@/lib/notifications';
import { restoreOrderStock, stockRestoreSummary, type RestoreLine } from '@/lib/order-stock';
import { completionOf, orderLinesOf, refundCapOf } from '@/lib/returns';
import { Order, Return, writeAuditLog } from '@/lib/services';

/*
 * Sprint 5 EP-13.US02 / US03 (D-107, D-108, D-109): the seller's actions on a return. Each is ONE compare-and-set on the return:
 *
 *   approve / reject   requested -> approved | rejected
 *   receive            approved -> received, then ONLY the winner puts the chosen quantities back on the shelf (reason return_restock), so a
 *                      repeat or a parallel request restocks nothing twice; when every delivered quantity of the order is back across its returns
 *                      the order goes delivered -> returned through its OWN compare-and-set (ORDER_FLOW forbids that move on purpose)
 *   refund             records one refund (whole rupees, in parts) up to the paid value of what came back, one compare-and-set on the running
 *                      total; refunded when the cap is reached; the proportional commission reversal is written once per return
 *
 * Nothing here moves money: the seller pays the customer back by their own means and only records it. Every route has already checked the
 * store belongs to the seller; every read and write below is filtered by that store id. Audit entries hold ids, numbers and rupee amounts
 * only: never a phone, an email or free text.
 */

type Row = Record<string, unknown>;
export const RETURN_RESTOCK_REASON = 'return_restock';

export interface Actor {
  userObjectId: unknown;
  /** As it appears in the audit log, for example seller:<id>. */
  auditActor: string;
}

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);

export const returnNotFound = (): HttpError => new HttpError(404, 'Return not found');
/** 409: the return is not in the state the action needs (a second decision, or a parallel request won). */
const changed = (_status?: unknown): HttpError => new HttpError(409, 'This return changed while you were working on it. Reload it and try again.', 'RETURN_STATUS_CHANGED');

async function audit(action: string, actor: Actor, returnId: unknown, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'return', String(returnId), actor.auditActor, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the return audit entry', { returnId: String(returnId) }, err instanceof Error ? err.name : 'unknown');
  }
}

export async function readReturn(storeId: string, id: string): Promise<Row | null> {
  return (await Return.findOne({ _id: id, store: storeId }).lean()) as unknown as Row | null;
}

export async function readOrderOf(storeId: string, returnDoc: Row): Promise<Row | null> {
  return (await Order.findOne({ _id: returnDoc.order, store: storeId }).lean()) as unknown as Row | null;
}

// ------------------------------------------------------------------------------------------------------ approve and reject

/** requested -> approved. The shopper is told by email when the order has one. */
export async function approveReturn(storeId: string, id: string, actor: Actor): Promise<{ doc: Row; order: Row | null }> {
  const current = await readReturn(storeId, id);
  if (!current) throw returnNotFound();
  const updated = (await Return.findOneAndUpdate({ _id: id, store: storeId, status: 'requested' }, { $set: { status: 'approved' } }, { new: true }).lean()) as unknown as Row | null;
  if (!updated) {
    if (!(await readReturn(storeId, id))) throw returnNotFound();
    throw changed((await readReturn(storeId, id))?.status);
  }
  const order = await readOrderOf(storeId, updated);
  await audit('return.approve', actor, id, { storeId, returnNumber: updated.returnNumber ?? null });
  notifyReturnDecision(storeId, updated, order, 'approved', null);
  return { doc: updated, order };
}

/** requested -> rejected, with the seller's reason (5 to 200 characters). The reason is stored on the return, never in the audit entry. */
export async function rejectReturn(storeId: string, id: string, actor: Actor, body: ReturnRejectRequest): Promise<{ doc: Row; order: Row | null }> {
  const current = await readReturn(storeId, id);
  if (!current) throw returnNotFound();
  const updated = (await Return.findOneAndUpdate(
    { _id: id, store: storeId, status: 'requested' },
    { $set: { status: 'rejected', rejectReason: body.reason, resolvedAt: new Date() } },
    { new: true },
  ).lean()) as unknown as Row | null;
  if (!updated) {
    if (!(await readReturn(storeId, id))) throw returnNotFound();
    throw changed((await readReturn(storeId, id))?.status);
  }
  const order = await readOrderOf(storeId, updated);
  await audit('return.reject', actor, id, { storeId, returnNumber: updated.returnNumber ?? null });
  notifyReturnDecision(storeId, updated, order, 'rejected', body.reason);
  return { doc: updated, order };
}

// ------------------------------------------------------------------------------------------------------------------ receive

export interface ReceiveResult {
  doc: Row;
  order: Row | null;
  stockRestore: OrderStockRestore;
  /** True when this receive brought the last delivered quantity back and the order moved delivered -> returned. */
  orderReturned: boolean;
}

/**
 * approved -> received with what came back. The compare-and-set on { status: approved } decides who restocks: only the winner puts the
 * chosen quantities back (never above what was asked for, and only the lines marked restock), so the stock goes back at most once.
 */
export async function receiveReturn(storeId: string, id: string, actor: Actor, body: ReturnReceiveRequest): Promise<ReceiveResult> {
  const current = await readReturn(storeId, id);
  if (!current) throw returnNotFound();
  if (current.status !== 'approved') throw changed(current.status);
  const order = await readOrderOf(storeId, current);
  if (!order) throw returnNotFound();

  const asked = new Map<string, number>();
  for (const item of Array.isArray(current.items) ? (current.items as Row[]) : []) asked.set(returnLineKey({ productId: String(item.productId), variantId: String(item.variantId) }), whole(item.quantity));
  const seen = new Set<string>();
  const received: Array<{ productId: string; variantId: string; quantity: number; restock: boolean }> = [];
  for (const [index, item] of body.items.entries()) {
    const key = returnLineKey(item);
    const field = 'items.' + index + '.quantity';
    if (seen.has(key)) throw new HttpError(400, 'Each item can be listed once.', 'RETURN_BODY_INVALID', 'items.' + index + '.productId');
    seen.add(key);
    const max = asked.get(key);
    if (max === undefined) throw new HttpError(400, 'This item is not part of the return.', 'RETURN_BODY_INVALID', 'items.' + index + '.productId');
    if (item.quantity > max) throw new HttpError(400, 'At most ' + max + ' of this item came back.', 'RETURN_BODY_INVALID', field);
    received.push({ productId: item.productId, variantId: item.variantId, quantity: item.quantity, restock: item.restock });
  }

  const updated = (await Return.findOneAndUpdate({ _id: id, store: storeId, status: 'approved' }, { $set: { status: 'received', received, receivedAt: new Date() } }, { new: true }).lean()) as unknown as Row | null;
  if (!updated) {
    const latest = await readReturn(storeId, id);
    if (!latest) throw returnNotFound();
    throw changed(latest.status);
  }

  // Only the winner gets here: the restock happens once.
  const orderLines = new Map(orderLinesOf(order).map((line) => [returnLineKey(line), line]));
  const rawItems = new Map((Array.isArray(order.items) ? (order.items as Row[]) : []).map((item) => [returnLineKey({ productId: String(item.productId), variantId: String(item.variantId) }), item]));
  const lines: RestoreLine[] = received
    .filter((entry) => entry.restock)
    .map((entry) => {
      const key = returnLineKey(entry);
      const raw = rawItems.get(key) ?? {};
      return {
        productId: entry.productId,
        variantId: entry.variantId,
        productTitle: orderLines.get(key)?.productTitle ?? '',
        variantTitle: orderLines.get(key)?.variantTitle ?? '',
        sku: typeof raw.sku === 'string' ? raw.sku : null,
        quantity: entry.quantity,
        stockDeducted: typeof raw.stockDeducted === 'boolean' ? raw.stockDeducted : undefined,
      } as RestoreLine;
    });
  const stockRestore = lines.length === 0 ? { restored: [], skipped: [], failed: [] } : await restoreOrderStock(storeId, String(order._id), actor.userObjectId, lines, RETURN_RESTOCK_REASON);

  const orderReturned = await markOrderReturnedIfAllBack(storeId, order, actor);
  await audit('return.receive', actor, id, {
    storeId,
    returnNumber: updated.returnNumber ?? null,
    lines: received.length,
    restocked: stockRestore.restored.length,
    skipped: stockRestore.skipped.length,
    failed: stockRestore.failed.length,
    summary: stockRestoreSummary(stockRestore),
    orderReturned,
  });
  return { doc: updated, order: orderReturned ? await readOrderOf(storeId, updated) : order, stockRestore, orderReturned };
}

/**
 * When every delivered quantity of the order has been received across its returns (restocked or not), the order moves delivered ->
 * returned through its OWN compare-and-set on { status: delivered } with a statusHistory entry. A partial return leaves the order delivered.
 * ORDER_FLOW forbids this move by design, so it does not go through the transition route.
 */
export async function markOrderReturnedIfAllBack(storeId: string, order: Row, actor: Actor): Promise<boolean> {
  if (order.status !== 'delivered') return false;
  const returns = (await Return.find({ store: storeId, order: order._id, status: { $in: ['received', 'refunded'] } }).lean()) as unknown as Row[];
  const back: Array<{ productId: string; variantId: string; quantity: number }> = [];
  for (const doc of returns) {
    for (const entry of Array.isArray(doc.received) ? (doc.received as Row[]) : []) {
      back.push({ productId: String(entry.productId), variantId: String(entry.variantId), quantity: whole(entry.quantity) });
    }
  }
  if (!everythingReceived(orderLinesOf(order), back)) return false;
  const at = new Date();
  const moved = await Order.findOneAndUpdate(
    { _id: order._id, store: storeId, status: 'delivered' },
    { $set: { status: 'returned' }, $push: { statusHistory: { from: 'delivered', to: 'returned', by: actor.userObjectId, at, note: 'Every item was returned', kind: 'status' } } },
    { new: true, runValidators: true },
  ).lean();
  if (moved) {
    try {
      await writeAuditLog('order.returned', 'order', String(order._id), actor.auditActor, { storeId, orderId: order.orderId ?? null, at: at.toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the order returned audit entry', err instanceof Error ? err.name : 'unknown');
    }
  }
  return moved !== null;
}

// ------------------------------------------------------------------------------------------------------------------- refund

export interface RefundResult {
  doc: Row;
  cap: number;
  /** True when this refund reached the cap and the return is now refunded. */
  completed: boolean;
  /** The proportional commission reversal written for this return (null when none was due or it already existed). */
  reversal: ReturnReversalResult | null;
}

/**
 * Records one refund. Only after the return was received, only for a cash on delivery order (a card order answers 422 CARD_REFUND_UNSUPPORTED),
 * between 1 rupee and what is left of the paid value of the returned quantities (price less discount share, delivery excluded). ONE
 * compare-and-set on { status: received, refundAmount: the running total that was read }: two parallel refunds leave a correct sum, the
 * loser reads 409. The running total is refundAmount; the entries are refunds[].
 */
export async function recordRefund(storeId: string, id: string, actor: Actor, body: ReturnRefundRequest): Promise<RefundResult> {
  const current = await readReturn(storeId, id);
  if (!current) throw returnNotFound();
  const order = await readOrderOf(storeId, current);
  if (!order) throw returnNotFound();
  if (order.paymentMethod === 'card') throw new HttpError(422, CARD_REFUND_UNSUPPORTED_MESSAGE, CARD_REFUND_UNSUPPORTED);
  if (current.status !== 'received') {
    throw new HttpError(409, current.status === 'refunded' ? 'This return is already fully refunded.' : 'A refund can only be recorded after the items were received.', 'RETURN_STATUS_CHANGED');
  }
  // SB-6 (bug 6): the return that completes the received quantities of the whole order takes the order base minus what the earlier ones took.
  const siblings = (await Return.find({ store: storeId, order: current.order, status: { $in: ['received', 'refunded'] } }).lean()) as unknown as Row[];
  const completion = completionOf(current, siblings, order);
  const cap = refundCapOf(current, order, completion.completes ? completion.earlierBase : null) ?? 0;
  const recorded = whole(current.refundAmount);
  const room = refundRoom(cap, recorded);
  if (body.amount > room) {
    throw new HttpError(422, room === 0 ? 'Nothing is left to refund on this return.' : 'At most Rs. ' + room + ' can still be refunded on this return.', 'REFUND_EXCEEDS_CAP', 'amount');
  }
  const total = recorded + body.amount;
  const completed = total >= cap;
  const at = new Date();
  const updated = (await Return.findOneAndUpdate(
    // The running total that was read is part of the filter: a parallel refund that landed first makes this one find nothing.
    { _id: id, store: storeId, status: 'received', refundAmount: recorded === 0 ? { $in: [null, 0] } : recorded },
    {
      $set: { refundAmount: total, refundType: 'cod_refund', ...(completed ? { status: 'refunded', resolvedAt: at } : {}) },
      $push: { refunds: { amount: body.amount, method: body.method, reference: body.reference, at, by: actor.userObjectId } },
    },
    { new: true, runValidators: true },
  ).lean()) as unknown as Row | null;
  if (!updated) {
    if (!(await readReturn(storeId, id))) throw returnNotFound();
    throw new HttpError(409, 'A refund was recorded at the same time. Reload the return and check the total.', 'RETURN_STATUS_CHANGED');
  }

  // ONE reversal per return, written with the first refund (a repeat finds it). Best effort: a ledger problem never undoes the refund.
  const reversal = await reverseForReturn({
    returnId: updated._id,
    order: { _id: order._id, store: order.store, orderId: String(order.orderId ?? ''), paymentMethod: order.paymentMethod },
    returnedBase: cap,
    completesOrder: completion.completes,
  });
  await audit('return.refund', actor, id, { storeId, returnNumber: updated.returnNumber ?? null, amount: body.amount, method: body.method, completed });
  return { doc: updated, cap, completed, reversal };
}
