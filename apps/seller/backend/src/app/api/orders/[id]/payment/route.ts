import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate, type AuthContext } from '@/lib/auth';
import { nextStatuses, orderPaymentRequestSchema, paymentRefusal } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { handleOrderError, OrderRequestError, readOrderBody, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, Order, ORDER_ACTIONS, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

interface StoredOrder {
  _id: unknown;
  orderId?: string;
  status?: unknown;
  paymentMethod?: unknown;
  paymentStatus?: unknown;
  total?: unknown;
}

const notFound = (): HttpError => new HttpError(404, 'Order not found');

const readOrder = async (id: string, storeId: string): Promise<StoredOrder | null> =>
  (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredOrder | null;

const unchanged = (row: unknown): Response =>
  NextResponse.json({ changed: false, order: toDashboardOrderDetail(row) }, { headers: NO_STORE });

const inHundredths = (value: number): number => Math.round(value * 100);

async function audit(ctx: AuthContext, storeId: string, row: StoredOrder, amount: number, status: string): Promise<void> {
  try {
    await writeAuditLog('order.payment', 'order', String(row._id), 'seller:' + ctx.userId, {
      storeId,
      orderId: row.orderId ?? null,
      amount,
      status,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order payment audit entry', { orderId: String(row._id) }, err);
  }
}

/**
 * POST /api/orders/:id/payment   body: { amount? }   (left out, it means the order total)
 *
 * Marks a COD order collected, once it is dispatched or delivered (D-064). Store owner only (D-067). There is no undo.
 *
 *   200 { changed: true, order }    collected; one history entry "COD collected: Rs. ..."
 *   200 { changed: false, order }   already collected, by this or a parallel request: nothing written
 *   400 ORDER_BODY_INVALID { field }   401   403 admin or another store   404 bad id, unknown, another store's order
 *   409 ORDER_STATUS_CHANGED { status, allowedNext }   the order moved on between the read and the write
 *   422 PAYMENT_NOT_COD
 *   422 PAYMENT_NOT_ALLOWED { status, reason: before_dispatch | order_closed }
 *   422 PAYMENT_AMOUNT_MISMATCH { expected }           partial collection is not in this epic
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { operation, collection } = ORDER_ACTIONS.payment;
    // The role check first, so an admin is refused whatever the body holds.
    assertCan(ctx.actor, operation, collection, ['amount']);
    const { id } = await context.params;

    const body = await readOrderBody(request, orderPaymentRequestSchema);
    // Leaving the amount out is valid, and an empty field list is always denied, so only sent keys are checked.
    const keys = Object.keys(body);
    if (keys.length > 0) assertCan(ctx.actor, operation, collection, keys);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const current = await readOrder(id, storeId);
    if (!current) throw notFound();

    if (current.paymentMethod !== 'cod') {
      throw new OrderRequestError(422, 'PAYMENT_NOT_COD', 'Only cash on delivery orders can be marked collected.');
    }
    const status = String(current.status ?? '');
    const refusal = paymentRefusal(status);
    if (refusal !== null) {
      throw new OrderRequestError(
        422,
        'PAYMENT_NOT_ALLOWED',
        refusal === 'before_dispatch' ? 'Cash can be marked collected only after the order is dispatched.' : 'This order is closed.',
        { status, reason: refusal },
      );
    }
    const total = typeof current.total === 'number' ? current.total : 0;
    if (body.amount !== undefined && inHundredths(body.amount) !== inHundredths(total)) {
      throw new OrderRequestError(422, 'PAYMENT_AMOUNT_MISMATCH', 'The amount must equal the order total.', { expected: total });
    }
    if (current.paymentStatus === 'collected') return unchanged(current);

    const now = new Date();
    const updated = await Order.findOneAndUpdate(
      { _id: id, store: storeId, status: { $in: ['dispatched', 'delivered'] }, paymentStatus: { $ne: 'collected' } },
      {
        $set: { paymentStatus: 'collected', collectedAt: now, collectedAmount: total },
        $push: {
          statusHistory: {
            from: status,
            to: status,
            by: ctx.userObjectId,
            at: now,
            note: 'COD collected: Rs. ' + total.toLocaleString('en-US'),
            kind: 'payment',
          },
        },
      },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      const latest = await readOrder(id, storeId);
      if (!latest) throw notFound();
      if (latest.paymentStatus === 'collected') return unchanged(latest);
      const latestStatus = String(latest.status ?? '');
      throw new OrderRequestError(409, 'ORDER_STATUS_CHANGED', 'This order changed while you were working on it. Reload it and try again.', {
        status: latestStatus,
        allowedNext: nextStatuses(latestStatus),
      });
    }

    await audit(ctx, storeId, current, total, status);
    return NextResponse.json({ changed: true, order: toDashboardOrderDetail(updated) }, { headers: NO_STORE });
  } catch (err) {
    return handleOrderError(err);
  }
}
