import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

/** The old Payload tiers. Kept so documents written before Sprint 6 still load; new plans have no tier. */
export const SUBSCRIPTION_TIERS = ['basic', 'pro', 'premium'] as const;

export const PLAN_INTERVALS = ['month'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/** A plan key is a slug: lower case letters, digits and hyphens, starting with a letter (2 to 30 characters). */
export const PLAN_KEY_PATTERN = /^[a-z][a-z0-9-]{1,29}$/;

const wholeNumber = { validator: Number.isInteger, message: 'must be a whole number' };

/** A limit is a whole number of 0 or more, or null for unlimited. */
const limit = { type: Number, default: null, min: 0, validate: wholeNumber };

/**
 * Sprint 6 EP-14 (D-118): the plan limits. null means unlimited. Money is whole rupees: priceRs is an integer.
 */
const limitsSchema = new Schema(
  {
    stores: limit,
    products: limit,
    staffSeats: limit,
    apiKeys: limit,
    customDomain: { type: Boolean, default: false },
    premiumThemes: { type: Boolean, default: false },
  },
  { _id: false },
);

/**
 * Collection: subscriptionPlans. Plans are DATA (D-118): an operator creates, edits and archives them in the admin console.
 *
 * It began as the three Payload fields (name, stripePriceId, tier). Sprint 6 rewrote it, and every new field is optional or has a
 * default, so an old document still loads: it has no key, no price and no limits, and the console shows it as an old plan. tier is
 * kept readable for them. stripePriceId is optional (a manually paid plan has none).
 *
 * key is unique among the documents that have one (a partial index: old documents without a key do not collide with each other).
 * revision is the compare-and-set counter of the admin routes.
 */
const subscriptionPlanSchema = new Schema(
  {
    key: { type: String, match: PLAN_KEY_PATTERN, maxlength: 30 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    priceRs: { type: Number, min: 0, validate: wholeNumber },
    interval: { type: String, enum: [...PLAN_INTERVALS], default: 'month' },
    limits: { type: limitsSchema },
    features: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, validate: wholeNumber },
    stripePriceId: { type: String },
    /** The old Payload tier. Readable for old documents; not written by the new routes. */
    tier: { type: String, enum: [...SUBSCRIPTION_TIERS] },
    archivedAt: { type: Date, default: null },
    revision: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'subscriptionPlans' },
);

// One plan per key. Partial: an old plan has no key and must not collide with another old plan. The admin and seller backends do not
// build indexes at runtime in production, so scripts/ensure-indexes.mjs creates it (it reads every model's declared indexes).
subscriptionPlanSchema.index({ key: 1 }, { unique: true, name: 'plan_key_unique', partialFilterExpression: { key: { $type: 'string' } } });
subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

export type SubscriptionPlanDoc = InferSchemaType<typeof subscriptionPlanSchema>;

export const SubscriptionPlanModel: Model<SubscriptionPlanDoc> =
  (models.SubscriptionPlan as Model<SubscriptionPlanDoc> | undefined) ??
  model<SubscriptionPlanDoc>('SubscriptionPlan', subscriptionPlanSchema);
