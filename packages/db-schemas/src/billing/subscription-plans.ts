
import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

export const SUBSCRIPTION_TIERS = ['basic', 'pro', 'premium'] as const;

/**
 * Mirrors the Payload SubscriptionPlans collection (apps/admin/src/collections/SubscriptionPlans.ts).
 * Collection: subscriptionPlans. These are the only three fields Payload defines.
 */
const subscriptionPlanSchema = new Schema(
  {
    name: { type: String, required: true },
    stripePriceId: { type: String, required: true },
    tier: { type: String, enum: [...SUBSCRIPTION_TIERS], required: true },
  },
  { timestamps: true, collection: 'subscriptionPlans' },
);

export type SubscriptionPlanDoc = InferSchemaType<typeof subscriptionPlanSchema>;

export const SubscriptionPlanModel: Model<SubscriptionPlanDoc> =
  (models.SubscriptionPlan as Model<SubscriptionPlanDoc> | undefined) ??
  model<SubscriptionPlanDoc>('SubscriptionPlan', subscriptionPlanSchema);
