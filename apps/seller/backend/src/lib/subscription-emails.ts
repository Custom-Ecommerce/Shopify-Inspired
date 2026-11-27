import * as notificationsNs from '@markaz/notifications';
import type { EnqueueResult } from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { PAYMENT_METHOD_LABELS } from '@/lib/contracts';
import { enqueueEmail, runAfterResponse, sellerDashboardLink } from '@/lib/notifications';
import { readPlanSettings } from '@/lib/platform-settings';
import { pushPaymentClaim, pushSubscriptionPayment } from '@/lib/push';
import { Store, SubscriptionPlanModel, User } from '@/lib/services';

// The package is CommonJS, read through the default object like lib/notifications.ts.
const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

/**
 * Sprint 6 EP-14 (S6-B4, D-118): the emails of manual subscription payments, through the notification outbox (D-091).
 *
 *   payment claimed        to the platform's support address (platform setting supportEmail); skipped when there is none
 *   payment confirmed      to the seller
 *   payment rejected       to the seller (a voided payment uses the same words with its own key)
 *   subscription expiring  to the seller, once per subscription and period (the expiry job; 7 days before the period ends)
 *   subscription expired   to the seller, once per subscription and period
 *
 * Every entry point catches everything and logs without secrets: a message can never change, delay or fail the payment or the job that
 * caused it. The dedupe key makes a second call (a retry, a second job run) a no-op in the outbox.
 */

const DASHBOARD_FALLBACK = 'your Markazify dashboard';

const errorText = (err: unknown): string => (err instanceof Error ? err.name : 'unknown');

/** "20 December 2026", in UTC, so a server's time zone never moves the day. */
export function formatMailDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface PaymentMailFields {
  id: string;
  seller: string;
  planKey: string;
  amountRs: number;
  method?: string | null;
  reference?: string | null;
  periodEnd?: Date | string | null;
  reason?: string | null;
}

interface SellerInfo {
  name: string;
  email: string;
}

async function sellerInfo(sellerId: string): Promise<SellerInfo | null> {
  const user = (await User.findById(sellerId).select('name email').lean()) as { name?: unknown; email?: unknown } | null;
  if (!user || typeof user.email !== 'string' || user.email === '') return null;
  return { name: typeof user.name === 'string' && user.name.trim() !== '' ? user.name : user.email, email: user.email };
}

async function planNameOf(planKey: string): Promise<string> {
  const plan = (await SubscriptionPlanModel.findOne({ key: planKey } as never).select('name').lean()) as { name?: unknown } | null;
  return typeof plan?.name === 'string' && plan.name !== '' ? plan.name : planKey;
}

/** The seller's billing page: under their first store. A seller with no store gets the words, not a link. */
export async function billingLinkFor(sellerId: string): Promise<string> {
  const store = (await Store.findOne({ owner: sellerId } as never).select('_id').sort({ createdAt: 1 }).lean()) as { _id?: unknown } | null;
  return (store?._id ? sellerDashboardLink(String(store._id), '/billing') : null) ?? DASHBOARD_FALLBACK;
}

const methodLabel = (method: string | null | undefined): string => (method && method in PAYMENT_METHOD_LABELS ? (PAYMENT_METHOD_LABELS as Record<string, string>)[method]! : 'Not stated');

/** To the platform's support address: a seller says they paid. Key payment_claimed:<payment id>. */
export async function sendPaymentClaimed(payment: PaymentMailFields): Promise<void> {
  const settings = await readPlanSettings();
  if (settings.supportEmail === null) return;
  const seller = await sellerInfo(payment.seller);
  if (!seller) return;
  await enqueueEmail({
    template: 'payment_claimed',
    to: settings.supportEmail,
    vars: {
      customerName: seller.name,
      sellerEmail: seller.email,
      planName: await planNameOf(payment.planKey),
      paymentAmount: notifications.formatRupees(payment.amountRs),
      paymentMethod: methodLabel(payment.method),
      paymentReference: payment.reference && payment.reference !== '' ? payment.reference : 'Not stated',
    },
    dedupeKey: 'payment_claimed:' + payment.id,
  });
}

/** To the seller: the payment is confirmed and the plan runs until the period end. Key payment_confirmed:<payment id>. */
export async function sendPaymentConfirmed(payment: PaymentMailFields): Promise<void> {
  const seller = await sellerInfo(payment.seller);
  const end = payment.periodEnd ? new Date(payment.periodEnd) : null;
  if (!seller || end === null || Number.isNaN(end.getTime())) return;
  await enqueueEmail({
    template: 'payment_confirmed',
    to: seller.email,
    vars: {
      customerName: seller.name,
      planName: await planNameOf(payment.planKey),
      paymentAmount: notifications.formatRupees(payment.amountRs),
      periodEnd: formatMailDate(end),
      dashboardLink: await billingLinkFor(payment.seller),
    },
    dedupeKey: 'payment_confirmed:' + payment.id,
  });
}

/** To the seller: the payment was not accepted (rejected) or was taken back (voided), with the admin's reason. */
export async function sendPaymentRejected(payment: PaymentMailFields, kind: 'rejected' | 'voided' = 'rejected'): Promise<void> {
  const seller = await sellerInfo(payment.seller);
  if (!seller) return;
  await enqueueEmail({
    template: 'payment_rejected',
    to: seller.email,
    vars: {
      customerName: seller.name,
      planName: await planNameOf(payment.planKey),
      paymentAmount: notifications.formatRupees(payment.amountRs),
      paymentReason: payment.reason && payment.reason.trim() !== '' ? payment.reason : 'No reason was given.',
      dashboardLink: await billingLinkFor(payment.seller),
    },
    dedupeKey: 'payment_' + kind + ':' + payment.id,
  });
}

export interface SubscriptionMailFields {
  subscriptionId: string;
  seller: string;
  planKey: string;
  periodEnd: Date;
}

/** 7 days before the period ends. Key subscription_expiring:<subscription>:<period end>: one per subscription and period. */
export async function sendSubscriptionExpiring(sub: SubscriptionMailFields): Promise<EnqueueResult | null> {
  const seller = await sellerInfo(sub.seller);
  if (!seller) return null;
  return enqueueEmail({
    template: 'subscription_expiring',
    to: seller.email,
    vars: { customerName: seller.name, planName: await planNameOf(sub.planKey), periodEnd: formatMailDate(sub.periodEnd), dashboardLink: await billingLinkFor(sub.seller) },
    dedupeKey: 'subscription_expiring:' + sub.subscriptionId + ':' + sub.periodEnd.getTime(),
  });
}

/** When the subscription has expired. Key subscription_expired:<subscription>:<period end>. */
export async function sendSubscriptionExpired(sub: SubscriptionMailFields): Promise<EnqueueResult | null> {
  const seller = await sellerInfo(sub.seller);
  if (!seller) return null;
  return enqueueEmail({
    template: 'subscription_expired',
    to: seller.email,
    vars: { customerName: seller.name, planName: await planNameOf(sub.planKey), dashboardLink: await billingLinkFor(sub.seller) },
    dedupeKey: 'subscription_expired:' + sub.subscriptionId + ':' + sub.periodEnd.getTime(),
  });
}

/** The job's own call: awaited, never throws. Returns whether the email step ran without an error. */
export async function guarded(label: string, job: () => Promise<void>): Promise<boolean> {
  try {
    await job();
    return true;
  } catch (err) {
    console.error('[seller-backend] subscription email failed', { job: label, error: errorText(err) });
    return false;
  }
}

/** After the response, best effort: a failed email never changes the payment. */
export function notifyPaymentClaimed(payment: PaymentMailFields): void {
  runAfterResponse('payment_claimed', () => sendPaymentClaimed(payment));
  runAfterResponse('push_payment_claim', async () => void (await pushPaymentClaim(payment.id, payment.amountRs)));
}
export function notifyPaymentConfirmed(payment: PaymentMailFields): void {
  runAfterResponse('payment_confirmed', () => sendPaymentConfirmed(payment));
  runAfterResponse('push_payment_confirmed', async () => void (await pushSubscriptionPayment(payment.seller, payment.id, 'confirmed', payment.amountRs)));
}
export function notifyPaymentRejected(payment: PaymentMailFields, kind: 'rejected' | 'voided' = 'rejected'): void {
  runAfterResponse('payment_' + kind, () => sendPaymentRejected(payment, kind));
  runAfterResponse('push_payment_' + kind, async () => void (await pushSubscriptionPayment(payment.seller, payment.id, kind, payment.amountRs)));
}
