import mongoose from 'mongoose';
import { adminDeviceDetails, AdminHttpError } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { adminPaymentListQuerySchema, confirmPaymentBodySchema, decidePaymentBodySchema } from '@/lib/admin-payment-contracts';
import { NO_STORE, requirePolicy } from '@/lib/admin-session';
import { confirmSubscriptionPayment, listSubscriptionPayments, rejectSubscriptionPayment, voidSubscriptionPayment } from '@/lib/seller-moderation-client';
import { assertCan, writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 6 EP-14 (S6-B4, D-118, D-093): the admin console's side of manual subscription payments. The routes check the operator's session and the
 * policy, validate the body, and forward ONE signed call to the seller backend, which owns the compare-and-set, the subscription write, the
 * audit entry and the email. The operator is the session's, never the body's. Kept out of the route files (Next allows only route exports there)
 * and written against injectable steps, so a test can stub the seller backend call.
 *
 * CAPABILITIES (S6-B6), declared by the route files: payments.read (owner, finance) for the list, payments.decide (owner, finance) for confirm and reject,
 * payments.void (owner only) for void.
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
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

const DECISION_FIELDS = ['status', 'decidedBy', 'decidedAt', 'reason', 'periodStart', 'periodEnd'] as const;

export type PaymentAction = 'confirm' | 'reject' | 'void';

/** GET /api/admin/subscription-payments?status&page&limit */
export async function listPaymentsFor(request: Request, userId: string): Promise<Response> {
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
export async function decidePaymentFor(request: Request, context: { params: Promise<{ id: string }> }, action: PaymentAction, userId: string): Promise<Response> {
  requirePolicy(() => assertCan('admin', 'update', 'subscriptionPayments', [...DECISION_FIELDS]));
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Payment not found');

  let answer: unknown;
  if (action === 'confirm') {
    const body = await readAdminBody(request, confirmPaymentBodySchema);
    answer = await paymentSteps.confirm(userId, { paymentId: id, amountRs: body.amountRs, reason: body.reason });
  } else {
    const body = await readAdminBody(request, decidePaymentBodySchema);
    answer = await paymentSteps[action](userId, { paymentId: id, reason: body.reason });
  }
  await auditPhoneDecision(request, action, id, userId);
  return Response.json(answer, { status: 200, headers: NO_STORE });
}

/**
 * Sprint 9 (EP-33.US02.T01): the seller backend audits the decision itself; a decision taken on a phone also names the device here. Best effort: the money
 * decision has already happened, so a failed entry is logged and the answer is still given.
 */
async function auditPhoneDecision(request: Request, action: PaymentAction, paymentId: string, userId: string): Promise<void> {
  const phone = adminDeviceDetails(request);
  if (!phone.device) return;
  try {
    await paymentSteps.audit('subscription_payment.phone_decision', 'subscriptionPayment', paymentId, userId, { ...phone, decision: action, at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write the phone decision audit entry', { paymentId, error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
  }
}
