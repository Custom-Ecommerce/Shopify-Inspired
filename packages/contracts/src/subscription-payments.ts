import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { planKeySchema } from './plans';

/**
 * Sprint 6 EP-14 (S6-B4, D-118): manual subscription payments, downgrade and cancel. Money is WHOLE RUPEES. The amount of a payment is the plan's
 * price, read by the server when the seller asks to upgrade: no request below carries an amount the server would believe, except the admin's
 * confirm, which carries the amount the admin SAW so a stale screen cannot confirm a different one (409).
 */

export const PAYMENT_STATUSES = ['requested', 'claimed', 'confirmed', 'rejected', 'void'] as const;
export const PAYMENT_METHODS = ['bank', 'jazzcash', 'easypaisa', 'other'] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = { bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', other: 'Other' };
export const PAYMENT_REFERENCE_MAX = 100;
export const PAYMENT_PROOF_URL_MAX = 300;
export const PAYMENT_REASON_MIN = 5;
export const PAYMENT_CONFIRM_REASON_MIN = 3;
export const PAYMENT_REASON_MAX = 300;

const plainText = (value: string): boolean => !/[<>]/.test(value);
const isoDate = z.string().datetime({ offset: true });

export const paymentMethodSchema = z.enum(PAYMENT_METHODS, { error: 'Choose bank, JazzCash, Easypaisa or other.' });

/** The transfer reference the seller types: plain text, 1 to 100 characters. */
export const paymentReferenceSchema = z
  .string({ error: 'Enter the transfer reference.' })
  .trim()
  .min(1, 'Enter the transfer reference.')
  .max(PAYMENT_REFERENCE_MAX, 'The reference can be at most ' + PAYMENT_REFERENCE_MAX + ' characters.')
  .refine(plainText, 'Use plain text: < and > are not allowed.');

/** An optional link to the proof (a screenshot or receipt): https only, at most 300 characters. */
export const paymentProofUrlSchema = z
  .string()
  .trim()
  .max(PAYMENT_PROOF_URL_MAX, 'The link can be at most ' + PAYMENT_PROOF_URL_MAX + ' characters.')
  .refine((value) => /^https:\/\/[^\s<>"']+$/i.test(value), 'The proof must be an https link.');

const reasonOf = (min: number, label: string) =>
  z
    .string({ error: 'Give a reason.' })
    .trim()
    .min(min, 'Give a ' + label + ' of at least ' + min + ' characters.')
    .max(PAYMENT_REASON_MAX, 'The reason can be at most ' + PAYMENT_REASON_MAX + ' characters.')
    .refine(plainText, 'Use plain text: < and > are not allowed.');

// ---------------------------------------------------------------------------------------------------------------------
// Seller requests

/** POST /api/subscription/payments: ask to upgrade (or renew). The amount is NOT here: it is the plan's price. */
export const upgradeRequestSchema = z.object({ planKey: planKeySchema }).strict();
export type UpgradeRequest = z.output<typeof upgradeRequestSchema>;

/** POST /api/subscription/payments/claim: "I paid". */
export const claimPaymentRequestSchema = z
  .object({
    paymentId: objectIdSchema,
    method: paymentMethodSchema,
    reference: paymentReferenceSchema,
    proofUrl: paymentProofUrlSchema.nullable().optional(),
  })
  .strict();
export type ClaimPaymentRequest = z.output<typeof claimPaymentRequestSchema>;

/** POST /api/subscription/downgrade: a lower plan from the period end. planKey null takes back a downgrade that was asked for. */
export const downgradeRequestSchema = z.object({ planKey: planKeySchema.nullable() }).strict();
export type DowngradeRequest = z.output<typeof downgradeRequestSchema>;

/** POST /api/subscription/cancel: true cancels at the period end (the plan stays until then), false takes the cancel back. */
export const cancelRequestSchema = z.object({ cancelAtPeriodEnd: z.boolean({ error: 'Choose yes or no.' }) }).strict();
export type CancelRequest = z.output<typeof cancelRequestSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// What a seller reads (their own only)

export const ownPaymentSchema = z.object({
  id: objectIdSchema,
  planKey: z.string(),
  amountRs: z.number().int().min(1),
  status: z.enum(PAYMENT_STATUSES),
  method: z.enum(PAYMENT_METHODS).nullable(),
  reference: z.string().nullable(),
  proofUrl: z.string().nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  /** The admin's reason when a payment was rejected or voided. */
  reason: z.string().nullable(),
  createdAt: isoDate,
  claimedAt: isoDate.nullable(),
  decidedAt: isoDate.nullable(),
});
export type OwnPayment = z.output<typeof ownPaymentSchema>;

/** The subscription as its owner reads it. null when the seller has none (the Free plan). */
export const ownSubscriptionSchema = z.object({
  planKey: z.string(),
  status: z.enum(['trial', 'active', 'grace', 'expired', 'cancelled']),
  periodStart: isoDate.nullable(),
  currentPeriodEnd: isoDate.nullable(),
  graceUntil: isoDate.nullable(),
  trialEndsAt: isoDate.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  pendingPlanKey: z.string().nullable(),
  source: z.enum(['manual', 'stripe']),
});
export type OwnSubscription = z.output<typeof ownSubscriptionSchema>;

/** GET /api/subscription */
export const ownSubscriptionResponseSchema = z.object({
  subscription: ownSubscriptionSchema.nullable(),
  /** The open payment (requested or claimed), if any. A seller has at most one. */
  open: ownPaymentSchema.nullable(),
  /** Newest first, at most 20. */
  payments: z.array(ownPaymentSchema),
});
export type OwnSubscriptionResponse = z.output<typeof ownSubscriptionResponseSchema>;

/** GET /api/subscription/instructions: how to pay, as the admin typed it. Plain text; whoever shows it escapes it. */
export const paymentInstructionsSchema = z.object({
  paymentInstructions: z.string().nullable(),
  supportEmail: z.string().nullable(),
  supportPhone: z.string().nullable(),
});
export type PaymentInstructions = z.output<typeof paymentInstructionsSchema>;

/** What exceeds the target plan's limits when a downgrade is refused (422 DOWNGRADE_EXCEEDS_LIMITS). */
export const DOWNGRADE_LIMITS = ['stores', 'products', 'staffSeats', 'apiKeys'] as const;
export const downgradeExceedsSchema = z.array(z.object({ limit: z.enum(DOWNGRADE_LIMITS), allowed: z.number().int().min(0), used: z.number().int().min(0) }));
export type DowngradeExceeds = z.output<typeof downgradeExceedsSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Admin (through the signed call to the seller backend)

export const adminPaymentSchema = z.object({
  id: objectIdSchema,
  seller: z.object({ id: objectIdSchema, name: z.string(), email: z.string() }),
  planKey: z.string(),
  planName: z.string(),
  amountRs: z.number().int().min(1),
  status: z.enum(PAYMENT_STATUSES),
  method: z.enum(PAYMENT_METHODS).nullable(),
  reference: z.string().nullable(),
  proofUrl: z.string().nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  reason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: isoDate.nullable(),
  createdAt: isoDate,
  claimedAt: isoDate.nullable(),
  revision: z.number().int().min(0),
});
export type AdminPayment = z.output<typeof adminPaymentSchema>;

export const adminPaymentListSchema = z.object({
  docs: z.array(adminPaymentSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalDocs: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  /** Payments waiting for a decision (claimed), for the badge. */
  pendingCount: z.number().int().min(0),
});
export type AdminPaymentList = z.output<typeof adminPaymentListSchema>;

export const adminPaymentWriteResponseSchema = z.object({ payment: adminPaymentSchema });
export type AdminPaymentWriteResponse = z.output<typeof adminPaymentWriteResponseSchema>;

/** GET /api/admin/subscription-payments?status&page&limit */
export const adminPaymentListQuerySchema = z
  .object({
    status: z.enum(PAYMENT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminPaymentListQuery = z.output<typeof adminPaymentListQuerySchema>;

/** Confirm. amountRs is the amount the admin saw: it must equal the payment's (409 otherwise). A reason is required. */
export const confirmPaymentBodySchema = z
  .object({
    amountRs: z.number({ error: 'The amount is required.' }).int('The amount must be whole rupees.').min(1, 'The amount must be at least 1.'),
    reason: reasonOf(PAYMENT_CONFIRM_REASON_MIN, 'reason'),
  })
  .strict();
export type ConfirmPaymentBody = z.output<typeof confirmPaymentBodySchema>;

/** Reject and void: a reason of at least 5 characters. */
export const decidePaymentBodySchema = z.object({ reason: reasonOf(PAYMENT_REASON_MIN, 'reason') }).strict();
export type DecidePaymentBody = z.output<typeof decidePaymentBodySchema>;

/** Admin backend -> seller backend, signed: one request per action; the payment id travels in the body. */
export const internalPaymentListRequestSchema = z
  .object({ status: z.enum(PAYMENT_STATUSES).optional(), page: z.number().int().min(1).max(10_000), limit: z.number().int().min(1).max(100) })
  .strict();
export const internalConfirmPaymentRequestSchema = z.object({ paymentId: objectIdSchema, amountRs: confirmPaymentBodySchema.shape.amountRs, reason: confirmPaymentBodySchema.shape.reason }).strict();
export const internalDecidePaymentRequestSchema = z.object({ paymentId: objectIdSchema, reason: decidePaymentBodySchema.shape.reason }).strict();
export type InternalConfirmPaymentRequest = z.output<typeof internalConfirmPaymentRequestSchema>;
export type InternalDecidePaymentRequest = z.output<typeof internalDecidePaymentRequestSchema>;
