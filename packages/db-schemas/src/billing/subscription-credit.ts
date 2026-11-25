import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

export const SUBSCRIPTION_CREDIT_REASONS = ['referral'] as const;

/**
 * Sprint 8 (S8-B6, D-118): free months a seller has earned. A credit never grants a plan: it lengthens a PAID period only. It is used at once when the seller has
 * a paid period running (the end moves), otherwise at their next confirmed payment. usedAt null means waiting; usedByPayment names the payment that took it, so
 * voiding that payment gives it back (null when it was added to a running period).
 *
 * The unique index on referral makes one referral worth at most one credit. Both indexes are declared here, so scripts/ensure-indexes.mjs creates them.
 */
const subscriptionCreditSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    months: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      validate: { validator: (value: unknown) => Number.isInteger(value), message: 'months must be a whole number' },
    },
    reason: { type: String, enum: [...SUBSCRIPTION_CREDIT_REASONS], required: true, default: 'referral' },
    referral: { type: Schema.Types.ObjectId, ref: 'Referral', required: true },
    usedAt: { type: Date, default: null },
    usedByPayment: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: 'subscriptioncredits' },
);

subscriptionCreditSchema.index({ referral: 1 }, { unique: true, name: 'referral_unique' });
subscriptionCreditSchema.index({ seller: 1, usedAt: 1 }, { name: 'seller_usedAt' });

export type SubscriptionCreditDoc = InferSchemaType<typeof subscriptionCreditSchema>;

export const SubscriptionCredit: Model<SubscriptionCreditDoc> =
  (models.SubscriptionCredit as Model<SubscriptionCreditDoc> | undefined) ?? model<SubscriptionCreditDoc>('SubscriptionCredit', subscriptionCreditSchema);
