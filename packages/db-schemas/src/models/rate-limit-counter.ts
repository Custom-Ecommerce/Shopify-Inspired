import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Collection: ratelimitcounters (D-081). One document per caller, rule and time window, shared by every backend
 * instance. The _id is the whole key, so one atomic upsert both creates and counts. MongoDB removes a counter once
 * expiresAt has passed; nothing else ever deletes one.
 */
export interface IRateLimitCounter {
  _id: string;
  count: number;
  expiresAt: Date;
}

const RateLimitCounterSchema = new Schema<IRateLimitCounter>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

RateLimitCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitCounter: Model<IRateLimitCounter> =
  (mongoose.models.RateLimitCounter as Model<IRateLimitCounter> | undefined) ??
  mongoose.model<IRateLimitCounter>('RateLimitCounter', RateLimitCounterSchema);
