import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { OrderTrackingRequest } from '@markaz/contracts';
import { authenticate, type AuthContext } from '@/lib/auth';
import { nextStatuses, orderTrackingRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { handleOrderError, OrderRequestError, toDashboardOrderDetail } from '@/lib/orders';
import { assertCan, Order, ORDER_ACTIONS, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

type TrackingField = 'courier' | 'trackingNumber' | 'trackingUrl';
const FIELDS: readonly TrackingField[] = ['courier', 'trackingNumber', 'trackingUrl'];
const FIELD_WORDS: Record<TrackingField, string> = { courier: 'courier', trackingNumber: 'tracking number', trackingUrl: 'tracking link' };

interface StoredOrder {
  _id: unknown;
  orderId?: string;
  status?: unknown;
  courier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}

const notFound = (): HttpError => new HttpError(404, 'Order not found');

async function readBody(request: NextRequest): Promise<OrderTrackingRequest> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', 'The request body must be a JSON object.', { field: null });
  }
  const parsed = orderTrackingRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? String(issue.path[0]) : null;
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid body.'), { field });
  }
  return parsed.data;
}

const readOrder = async (id: string, storeId: string): Promise<StoredOrder | null> =>
  (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredOrder | null;

/** The sent values that differ from what is stored. A missing stored value and null are the same (no link). */
function changesOf(current: StoredOrder, body: OrderTrackingRequest): Partial<Record<TrackingField, string | null>> {
  const changes: Partial<Record<TrackingField, string | null>> = {};
  for (const field of FIELDS) {
    const sent = body[field];
    if (sent === undefined) continue;
    if ((current[field] ?? null) !== sent) changes[field] = sent;
  }
  return changes;
}

async function audit(ctx: AuthContext, storeId: string, row: StoredOrder, changes: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog('order.tracking', 'order', String(row._id), 'seller:' + ctx.userId, {
      storeId,
      orderId: row.orderId ?? null,
      changes,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order tracking audit entry', { orderId: String(row._id) }, err);
  }
}

/**
 * POST /api/orders/:id/tracking   body: { courier?, trackingNumber?, trackingUrl? (null clears the link) }, at least one
 *
 * Edits the courier and tracking of a DISPATCHED order (OB-4, D-072: /transition ignores tracking on a repeat). Store owner
 * only (D-067).
 *
 *   200 { changed: true, order }    stored, plus one history entry dispatched -> dispatched "Tracking updated: ..."
 *   200 { changed: false, order }   every sent value was already stored: nothing written, no history entry
 *   400 ORDER_BODY_INVALID { field }   401   403 admin or another store   404 bad id, unknown, another store's order
 *   409 ORDER_STATUS_CHANGED { status, allowedNext }   the order left dispatched between the read and the write
 *   422 ORDER_TRACKING_ILLEGAL { status }               the order is not dispatched
 *
 * The write is ONE findOneAndUpdate filtered on { _id, store, status: 'dispatched' }, so tracking can never change on an
 * order that moved on to delivered in the meantime.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { operation, collection } = ORDER_ACTIONS.tracking;
    // The role check first, so an admin is refused whatever the body holds.
    assertCan(ctx.actor, operation, collection, ['courier']);
    const { id } = await context.params;

    const body = await readBody(request);
    assertCan(ctx.actor, operation, collection, Object.keys(body));

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const current = await readOrder(id, storeId);
    if (!current) throw notFound();
    const status = String(current.status ?? '');
    if (status !== 'dispatched') {
      throw new OrderRequestError(422, 'ORDER_TRACKING_ILLEGAL', 'Tracking can only be changed while the order is dispatched.', { status });
    }

    const changes = changesOf(current, body);
    const fields = FIELDS.filter((field) => field in changes);
    if (fields.length === 0) {
      return NextResponse.json({ changed: false, order: toDashboardOrderDetail(current) }, { headers: NO_STORE });
    }

    const note = 'Tracking updated: ' + fields.map((field) => FIELD_WORDS[field]).join(', ');
    const updated = await Order.findOneAndUpdate(
      { _id: id, store: storeId, status: 'dispatched' },
      {
        $set: changes,
        $push: { statusHistory: { from: 'dispatched', to: 'dispatched', by: ctx.userObjectId, at: new Date(), note } },
      },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      const latest = await readOrder(id, storeId);
      if (!latest) throw notFound();
      const now = String(latest.status ?? '');
      throw new OrderRequestError(409, 'ORDER_STATUS_CHANGED', 'This order changed while you were working on it. Reload it and try again.', {
        status: now,
        allowedNext: nextStatuses(now),
      });
    }

    await audit(ctx, storeId, current, changes);
    return NextResponse.json({ changed: true, order: toDashboardOrderDetail(updated) }, { headers: NO_STORE });
  } catch (err) {
    return handleOrderError(err);
  }
}
