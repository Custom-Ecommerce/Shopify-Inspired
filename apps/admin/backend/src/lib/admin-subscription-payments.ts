import mongoose from 'mongoose';
import { AdminHttpError } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { adminPaymentListQuerySchema, confirmPaymentBodySchema, decidePaymentBodySchema } from '@/lib/admin-payment-contracts';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { confirmSubscriptionPayment, listSubscriptionPayments, rejectSubscriptionPayment, voidSubscriptionPayment } from '@/lib/seller-moderation-client';
import { assertCan } from '@/lib/workspace';

/**
 * Sprint 6 EP-14 (S6-B4, D-118, D-093): the admin console's side of manual subscription payments. The routes check the operator's session and the
 * policy, validate the body, and forward ONE signed call to the seller backend, which owns the compare-and-set, the subscription write, the
 * audit entry and the email. The operator is the session's, never the body's. Kept out of the route files (Next allows only route exports there)
 * and written against injectable steps, so a test can stub the seller backend call.
 *
 * CAPABILITIES for the admin levels (S6-B6). Until they exist any admin may do all four; the guard test of S6-B6 adds the rows:
 *   subscription_payments.read      owner, finance, operations           the list
 *   subscription_payments.confirm   owner, finance                       a claimed payment becomes a paid period
 *   subscription_payments.reject    owner, finance, operations           a requested or claimed payment is refused
 *   subscription_payments.void      owner (a CONFIRMED payment), finance (an unconfirmed one)
 */
export const PAYMENT_CAPABILITIES = {
  read: 'subscription_payments.read',
  confirm: 'subscription_payments.confirm',
  reject: 'subscription_payments.reject',
  void: 'subscription_payments.void',
} as const;

export const paymentSteps = {
  list: listSubscriptionPayments,
  confirm: confirmSubscriptionPayment,
  reject: rejectSubscriptionPayment,
  void: voidSubscriptionPayment,
};

const DECISION_FIELDS = ['status', 'decidedBy', 'decidedAt', 'reason', 'periodStart', 'periodEnd'] as const;

export type PaymentAction = 'confirm' | 'reject' | 'void';

/** GET /api/admin/subscription-payments?status&page&limit */
export async function listPaymentsFor(request: Request): Promise<Response> {
  const { userId } = await authorizeAdmin(request);
  // CAPABILITY subscription_payments.read (S6-B6)
  requirePolicy(() => assertCan('admin', 'read', 'subscriptionPayments'));
  const parsed = adminPaymentListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })) },
      { status: 422, headers: NO_STORE },
    );
  }
  return Response.json(await paymentSteps.list(userId, parsed.data), { status: 200, headers: NO_STORE });
}

/** POST /api/admin/subscription-payments/:id/confirm | reject | void. The payment id is the path's; the body has the amount and the reason only. */
export async function decidePaymentFor(request: Request, context: { params: Promise<{ id: string }> }, action: PaymentAction): Promise<Response> {
  const { userId } = await authorizeAdmin(request);
  // CAPABILITY subscription_payments.confirm | reject | void (S6-B6): void of a confirmed payment is owner-only once the levels exist.
  requirePolicy(() => assertCan('admin', 'update', 'subscriptionPayments', [...DECISION_FIELDS]));
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Payment not found');

  if (action === 'confirm') {
    const body = await readAdminBody(request, confirmPaymentBodySchema);
    return Response.json(await paymentSteps.confirm(userId, { paymentId: id, amountRs: body.amountRs, reason: body.reason }), { status: 200, headers: NO_STORE });
  }
  const body = await readAdminBody(request, decidePaymentBodySchema);
  return Response.json(await paymentSteps[action](userId, { paymentId: id, reason: body.reason }), { status: 200, headers: NO_STORE });
}
