import { auditActorOf, type AuthContext } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { revisionFilter, revisionOf, RevisionConflictError } from '@/lib/mobile-revision';
import { OrderRequestError } from '@/lib/orders';
import { Order, writeAuditLog } from '@/lib/services';

/*
 * The one way an internal note is added to an order, shared by the portal route (POST /api/orders/:id/notes) and the phone. The rules were the route's own
 * (EP-02 OB-5a); Sprint 9 moved them here unchanged and added the optional revision of the phone.
 */

const notFound = (): HttpError => new HttpError(404, 'Order not found');

/** The note's text stays out of the audit log: only its length is recorded. */
async function audit(ctx: AuthContext, storeId: string, id: string, orderId: unknown, length: number): Promise<void> {
  try {
    await writeAuditLog('order.note', 'order', id, auditActorOf(ctx), {
      storeId,
      orderId: orderId ?? null,
      length,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the order note audit entry', { orderId: id }, err);
  }
}

/** Adds the note and answers the order. 404, 422 ORDER_NOTES_FULL, and with `revision` a RevisionConflictError when the order moved on. */
export async function addOrderNote(ctx: AuthContext, storeId: string, id: string, text: string, options: { revision?: number } = {}): Promise<unknown> {
  const current = (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as { orderId?: string; updatedAt?: unknown } | null;
  if (!current) throw notFound();
  if (options.revision !== undefined && revisionOf(current.updatedAt) !== options.revision) throw new RevisionConflictError(current);

  const updated = await Order.findOneAndUpdate(
    { _id: id, store: storeId, 'notes.99': { $exists: false }, ...(options.revision === undefined ? {} : revisionFilter(options.revision)) },
    { $push: { notes: { text, by: ctx.userObjectId, at: new Date() } } },
    { new: true, runValidators: true },
  ).lean();

  if (!updated) {
    // The order was there a moment ago, so the filter failed on the cap (unless it has since been removed or, for a phone, changed).
    const now = (await Order.findOne({ _id: id, store: storeId }).lean()) as unknown as { updatedAt?: unknown } | null;
    if (!now) throw notFound();
    if (options.revision !== undefined && revisionOf(now.updatedAt) !== options.revision) throw new RevisionConflictError(now);
    throw new OrderRequestError(422, 'ORDER_NOTES_FULL', 'This order already has the maximum of 100 notes.');
  }

  await audit(ctx, storeId, id, current.orderId, text.length);
  return updated;
}
