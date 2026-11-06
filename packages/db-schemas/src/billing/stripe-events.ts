import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

// Processed Stripe event ids. The _id is the Stripe event id, so a second insert with the
// same id fails with a duplicate-key error. That gives exactly-once processing (H-D).
const stripeEventSchema = new Schema(
  {
    _id: { type: String, required: true },
    type: { type: String, required: true, trim: true },
    receivedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'stripe-events' }
);

export type StripeEventDoc = InferSchemaType<typeof stripeEventSchema>;

export const StripeEventModel: Model<StripeEventDoc> =
  (models.StripeEvent as Model<StripeEventDoc> | undefined) ??
  model<StripeEventDoc>('StripeEvent', stripeEventSchema);
