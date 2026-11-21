import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';
import { PLAN_KEY_PATTERN } from './subscription-plans';

export const SUBSCRIPTION_PAYMENT_STATUSES = ['requested', 'claimed', 'confirmed', 'rejected', 'void'] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

export const SUBSCRIPTION_PAYMENT_METHODS = ['bank', 'jazzcash', 'easypaisa', 'other'] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

/** The statuses a payment is still open in: an admin has not decided it. A seller has at most one open payment. */
export const OPEN_PAYMENT_STATUSES = ['requested', 'claimed'] as const;

export const PAYMENT_REFERENCE_MAX = 100;
export const PAYMENT_PROOF_URL_MAX = 300;

const wholeRupees = { validator: Number.isInteger, message: 'must be whole rupees' };

/**
 * Sprint 6 EP-14 (D-118): a manual subscription payment. The seller asks to upgrade (requested; the amount is the plan's price, read by the server,
 * never sent by the client), pays by bank, JazzCash or Easypaisa and says so (claimed, with the method, the transfer reference and optionally a link
 * to the proof), and an admin checks the money and confirms (confirmed) or refuses (rejected). A payment can be voided. Nothing is ever deleted.
 *
 *   seller, planKey   who pays for which plan. amountRs is whole rupees, the plan's price when it was requested.
 *   periodStart/End   the period this payment buys: set only when it is confirmed (lib/subscription-period.ts)
 *   decidedBy/At      the admin who confirmed, rejected or voided it, and when; reason is theirs
 *   revision          the compare-and-set counter: every move is a conditional write on the status and the revision read, so two admins (or a
 *                     double click) cannot both confirm: exactly one write wins and only the winner extends the subscription
 *   isOpen            true while requested or claimed. The partial unique index below keeps it to ONE open payment per seller, whatever races.
 *   subscriptionBefore, subscriptionRevisionAfter   what the subscription was before this payment extended it and its revision after, so a
 *                     confirmed payment can be voided cleanly (and only while nothing else changed the subscription).
 *
 * The unique index is declared here, so scripts/ensure-indexes.mjs creates it (the backends build no index at runtime).
 */
const subscriptionPaymentSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planKey: { type: String, required: true, match: PLAN_KEY_PATTERN, maxlength: 30 },
    amountRs: { type: Number, required: true, min: 1, validate: wholeRupees },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    method: { type: String, enum: [...SUBSCRIPTION_PAYMENT_METHODS], default: null },
    reference: { type: String, maxlength: PAYMENT_REFERENCE_MAX, default: null },
    proofUrl: {
      type: String,
      maxlength: PAYMENT_PROOF_URL_MAX,
      default: null,
      validate: { validator: (value: string | null) => value === null || value === undefined || /^https:\/\//i.test(value), message: 'must be an https link' },
    },
    status: { type: String, enum: [...SUBSCRIPTION_PAYMENT_STATUSES], required: true, default: 'requested' },
    isOpen: { type: Boolean, default: true },
    decidedBy: { type: String, maxlength: 64, default: null },
    decidedAt: { type: Date, default: null },
    reason: { type: String, maxlength: 500, default: null },
    claimedAt: { type: Date, default: null },
    subscriptionBefore: { type: Schema.Types.Mixed, default: null },
    subscriptionRevisionAfter: { type: Number, default: null },
    revision: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'subscriptionPayments' },
);

subscriptionPaymentSchema.index({ seller: 1, status: 1 }, { name: 'seller_status' });
// One open payment per seller. Partial on an equality (supported on every MongoDB version; $in in a partial filter is not).
subscriptionPaymentSchema.index({ seller: 1 }, { unique: true, name: 'seller_open_unique', partialFilterExpression: { isOpen: true } });
// The admin's list: by status, newest first.
subscriptionPaymentSchema.index({ status: 1, createdAt: -1 }, { name: 'status_created' });

export type SubscriptionPaymentDoc = InferSchemaType<typeof subscriptionPaymentSchema>;

export const SubscriptionPayment: Model<SubscriptionPaymentDoc> =
  (models.SubscriptionPayment as Model<SubscriptionPaymentDoc> | undefined) ?? model<SubscriptionPaymentDoc>('SubscriptionPayment', subscriptionPaymentSchema);
