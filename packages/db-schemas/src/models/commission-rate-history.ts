import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const COMMISSION_RATE_SCOPES = ['store', 'platform'] as const;
export type CommissionRateScope = (typeof COMMISSION_RATE_SCOPES)[number];

/**
 * Collection: commissionratehistory (Sprint 4 EP-05.US02, D-089), in the ADMIN database. One row per change of a store's
 * custom commission rate or of the platform default: who, from what to what, when and why. Rows are only ever added.
 * A rate here is a percentage with one decimal; mode is 'inherit' (the platform default applies) or 'custom'.
 */
export interface ICommissionRateHistory {
  _id: Types.ObjectId;
  scope: CommissionRateScope;
  /** The store, for a store rate; null for the platform default. */
  store: Types.ObjectId | null;
  /** The admin who made the change. */
  actor: string;
  oldMode: 'inherit' | 'custom' | null;
  oldRate: number | null;
  newMode: 'inherit' | 'custom' | null;
  newRate: number | null;
  reason: string;
  createdAt: Date;
}

const CommissionRateHistorySchema = new Schema<ICommissionRateHistory>(
  {
    scope: { type: String, enum: [...COMMISSION_RATE_SCOPES], required: true },
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    actor: { type: String, required: true, maxlength: 64 },
    oldMode: { type: String, enum: ['inherit', 'custom', null], default: null },
    oldRate: { type: Number, default: null },
    newMode: { type: String, enum: ['inherit', 'custom', null], default: null },
    newRate: { type: Number, default: null },
    reason: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'commissionratehistory' },
);

CommissionRateHistorySchema.index({ store: 1, createdAt: -1 });
CommissionRateHistorySchema.index({ createdAt: -1 });

export const CommissionRateHistory: Model<ICommissionRateHistory> =
  (mongoose.models.CommissionRateHistory as Model<ICommissionRateHistory> | undefined) ??
  mongoose.model<ICommissionRateHistory>('CommissionRateHistory', CommissionRateHistorySchema);
