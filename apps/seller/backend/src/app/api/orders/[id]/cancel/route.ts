import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { OrderCancelRequest, OrderStockRestore } from '@markaz/contracts';
import { authenticate, type AuthContext } from '@/lib/auth';
import { cancelRefusal, canCancel, nextStatuses, ORDER_CANCEL_REFUSAL_MESSAGES, orderCancelRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { restoreOrderStock, stockRestoreSummary, type RestoreLine } from '@/lib/order-stock';
import { returnDiscountUse } from '@/lib/storefront/discount-service';
import { handleOrderError, OrderRequestError, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, Order, ORDER_ACTIONS, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

interface StoredOrder {
  _id: unknown;
  orderId?: string;
  status?: unknown;
  items?: RestoreLine[];
  discountCode?: string | null;
  discountSnapshot?: { discountId?: string } | null;
}

const notFound = (): HttpError => new HttpError(404, 'Order not found');

async function readBody(request: NextRequest): Promise<OrderCancelRequest> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', 'The request body must be a JSON object.', { field: null });
  }
  const parsed = orderCancelRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? String(issue.path[0]) : null;
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid body.'), { field });
  }
  return parsed.data;
}

const readOrder = async (id: string, storeId: string): Promise<StoredOrder | null> =>
  (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredOrder | null;

function illegal(status: string): OrderRequestError {
  const reason = cancelRefusal(status) ?? 'unknown_status';
  return new OrderRequestError(422, 'ORDER_CANCEL_ILLEGAL', ORDER_CANCEL_REFUSAL_MESSAGES[reason], { status, reason });
}

/**
 * Adds one history line naming what did not go back to stock, so the seller can see it later on the order. Best effort:
 * the audit entry carries the same summary.
 */
async function noteStockSummary(id: string, storeId: string, ctx: AuthContext, summary: string): Promise<unknown | null> {
  try {
    return await Order.findOneAndUpdate(
      { _id: id, store: storeId },
      { $push: { statusHistory: { from: 'cancelled', to: 'cancelled', by: ctx.userObjectId, at: new Date(), note: summary, kind: 'stock' } } },
      { new: true, runValidators: true },
    ).lean();
  } catch (err) {
    console.error('[seller-backend] could not note the stock restore on the order history', { orderId: id }, err);
    return null;
  }
}

async function audit(
  ctx: AuthContext,
  storeId: string,
  row: StoredOrder,
  from: string,
  body: OrderCancelRequest,
  stock: OrderStockRestore,
  summary: string | null,
  discountUse: string | null,
): Promise<void> {
  try {
    await writeAuditLog('order.cancel', 'order', String(row._id), 'seller:' + ctx.userId, {
      storeId,
      orderId: row.orderId ?? null,
      from,
      reason: body.reason,
      note: body.note || null,
      restored: stock.restored.length,
      skipped: stock.skipped,
      failed: stock.failed,
      summary,
      discountUse,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order cancel audit entry', { orderId: String(row._id) }, err);
  }
}

/**
 * POST /api/orders/:id/cancel   body: { reason (3..200), note? (max 500) }
 *
 * Cancels an order that has not been dispatched (D-064) and gives its stock back exactly once (D-066). Store owner only
 * (D-067).
 *
 *   200 { order, stockRestore: { restored, skipped, failed } }
 *   400 ORDER_BODY_INVALID { field }
 *   401 no session   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's order
 *   409 ORDER_STATUS_CHANGED { status, allowedNext, canCancel }   the order moved on between the read and the write
 *   422 ORDER_CANCEL_ILLEGAL { status, reason }                     dispatched or later, already cancelled, unknown status
 *
 * The cancel is ONE findOneAndUpdate filtered on { _id, store, status: <read status>, stockRestoredAt absent }: it sets
 * the status, cancelledAt, cancelReason and stockRestoredAt, plus discountRestoredAt when the order used a code, and pushes
 * the history entry. Only the request that wins it restores stock and returns the discount use, so two parallel cancels
 * give each back once (A-017). A discount deleted since the order is skipped.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { operation, collection } = ORDER_ACTIONS.cancel;
    // The role check first, so an admin is refused whatever the body holds.
    assertCan(ctx.actor, operation, collection, ['reason']);
    const { id } = await context.params;

    const body = await readBody(request);
    // The keys that survived parsing: unknown keys were dropped, so they are neither checked nor stored.
    assertCan(ctx.actor, operation, collection, Object.keys(body));

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const current = await readOrder(id, storeId);
    if (!current) throw notFound();
    const from = String(current.status ?? '');
    if (cancelRefusal(from) !== null) throw illegal(from);

    const now = new Date();
    const cancelled = await Order.findOneAndUpdate(
      { _id: id, store: storeId, status: from, stockRestoredAt: { $exists: false }, discountRestoredAt: { $exists: false } },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: body.reason,
          stockRestoredAt: now,
          ...(current.discountCode ? { discountRestoredAt: now } : {}),
        },
        $push: { statusHistory: { from, to: 'cancelled', by: ctx.userObjectId, at: now, note: body.note ? body.note : null } },
      },
      { new: true, runValidators: true },
    ).lean();

    if (!cancelled) {
      const latest = await readOrder(id, storeId);
      if (!latest) throw notFound();
      const status = String(latest.status ?? '');
      if (status === 'cancelled') throw illegal('cancelled');
      throw new OrderRequestError(409, 'ORDER_STATUS_CHANGED', 'This order changed while you were working on it. Reload it and try again.', {
        status,
        allowedNext: nextStatuses(status),
        canCancel: canCancel(status),
      });
    }

    // Only the winner gets here. The lines come from the order as it was cancelled.
    const lines = ((cancelled as unknown as StoredOrder).items ?? []) as RestoreLine[];
    const stockRestore = await restoreOrderStock(storeId, id, ctx.userObjectId, lines);
    const summary = stockRestoreSummary(stockRestore);
    const discountId = (cancelled as unknown as StoredOrder).discountSnapshot?.discountId;
    const discountUse = discountId ? await returnDiscountUse(storeId, discountId) : null;
    const finalRow = summary ? ((await noteStockSummary(id, storeId, ctx, summary)) ?? cancelled) : cancelled;

    await audit(ctx, storeId, current, from, body, stockRestore, summary, discountUse);
    return NextResponse.json({ order: toDashboardOrderDetail(finalRow), stockRestore }, { headers: NO_STORE });
  } catch (err) {
    return handleOrderError(err);
  }
}
