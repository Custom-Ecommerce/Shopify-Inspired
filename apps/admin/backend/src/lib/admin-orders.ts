import mongoose from 'mongoose';
import type { AdminOrderDetail, AdminOrderList, AdminOrderListQuery } from '../../../../../packages/contracts/src/admin-orders';
import { AdminHttpError } from '@/lib/admin-auth';
import { adminOrderListQuerySchema } from '@/lib/admin-payment-contracts';
import { readAdminQuery } from '@/lib/admin-payouts';
import { NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listAdminOrders, readAdminOrderDetail } from '@/lib/seller-moderation-client';
import { assertCan, writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 6 EP-12 (S6-B5, D-093): the admin console's READ-ONLY orders view. Every call is one signed call to the seller backend, which returns SAFE
 * fields only: no name, phone, address or email. The policy row is adminOrdersView (the old `orders` row is not used). Written against injectable
 * steps so a test can stub the seller backend and the audit.
 *
 * Audit: every DETAIL read is audited BEFORE the call and fails closed (no entry, no detail), like payoutDetails. The list is not audited (it holds
 * no more than a row each). The entry holds the order id and the admin, never an order's content.
 *
 * Rate limit: the admin backend's Mongo limiter exists only for its sign-in and password flows; there is no read-limit pattern, so reads are not
 * limited here (listed in the S6-B5 report).
 *
 * Capability: orders.read (owner, customer_support), declared by the route files (S6-B6).
 */
export const ORDERS_CAPABILITY = 'orders.read';

export const orderSteps = {
  list: listAdminOrders as (adminId: string, input: Record<string, unknown>) => Promise<AdminOrderList>,
  detail: readAdminOrderDetail as (adminId: string, input: { orderId: string }) => Promise<{ order: AdminOrderDetail }>,
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

const READ_FIELDS = ['orderNumber', 'store', 'status', 'paymentMethod', 'total', 'city', 'createdAt', 'updatedAt', 'itemCount'];

/** GET /api/admin/orders?store&status&from&to&q&page&limit */
export async function listOrdersFor(request: Request, userId: string): Promise<Response> {
  // The route file authorizes the admin with the orders.read capability (S6-B6).
  requirePolicy(() => assertCan('admin', 'read', 'adminOrdersView', READ_FIELDS));
  const query: AdminOrderListQuery = readAdminQuery(request, adminOrderListQuerySchema);
  return Response.json(await orderSteps.list(userId, query as unknown as Record<string, unknown>), { status: 200, headers: NO_STORE });
}

/** GET /api/admin/orders/:id */
export async function readOrderFor(_request: Request, context: { params: Promise<{ id: string }> }, userId: string): Promise<Response> {
  requirePolicy(() => assertCan('admin', 'read', 'adminOrdersView', ['orderNumber', 'items', 'totals', 'statusHistory']));
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Order not found');
  // Fails closed: when the entry cannot be written, the detail is not read.
  try {
    await orderSteps.audit('order.detail_viewed', 'order', id, userId, { at: new Date().toISOString() });
  } catch {
    throw new AdminHttpError(503, 'The order could not be opened because the audit entry could not be written.');
  }
  return Response.json(await orderSteps.detail(userId, { orderId: id }), { status: 200, headers: NO_STORE });
}
