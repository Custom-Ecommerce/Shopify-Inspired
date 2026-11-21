import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';
import { PLAN_KEY_PATTERN } from './subscription-plans';

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'grace', 'expired', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_SOURCES = ['manual', 'stripe'] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

/**
 * Sprint 6 EP-14 (D-118, CO-115): a seller's subscription. ONE per seller (the user id), so a seller is on one plan at a time. Plans are
 * data (SubscriptionPlanModel); planKey says which.
 *
 *   trial      free use of the plan until trialEndsAt; no payment yet. Without payment it expires.
 *   active     paid until currentPeriodEnd
 *   grace      the period ended; the plan's limits still apply until graceUntil (the platform setting graceDays)
 *   expired    nothing was paid: the seller falls back to the Free plan's limits. Nothing is deleted.
 *   cancelled  the seller (or an admin) cancelled; the plan stays until currentPeriodEnd, then the Free limits apply
 *
 * The stored status is moved by an admin (manual payment marked paid) and by the expiry job; the seller backend ALSO works the effective
 * status out from the dates on every read (lib/plan.ts), so a job that has not run yet never gives free limits away.
 *
 * source is manual (bank, JazzCash, Easypaisa; an admin marks it paid) or stripe (off, D-118). revision is the compare-and-set counter.
 *
 * The unique index on seller is declared here, so scripts/ensure-indexes.mjs creates it (the backends build no index at runtime).
 */
const subscriptionSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planKey: { type: String, required: true, match: PLAN_KEY_PATTERN, maxlength: 30 },
    status: { type: String, enum: [...SUBSCRIPTION_STATUSES], required: true, default: 'active' },
    periodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    graceUntil: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    source: { type: String, enum: [...SUBSCRIPTION_SOURCES], default: 'manual' },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    revision: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'subscriptions' },
);

subscriptionSchema.index({ seller: 1 }, { unique: true, name: 'seller_unique' });
// The expiry job reads the subscriptions of a status whose date has passed.
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 }, { name: 'status_period_end' });

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;

export const Subscription: Model<SubscriptionDoc> =
  (models.Subscription as Model<SubscriptionDoc> | undefined) ?? model<SubscriptionDoc>('Subscription', subscriptionSchema);
