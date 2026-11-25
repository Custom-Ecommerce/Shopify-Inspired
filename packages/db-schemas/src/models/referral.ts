import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: referrals (apps/admin/src/collections/Referrals.ts). A seller can be referred once.
 *
 * Sprint 8 (S8-B5, D-118): `referrer` and `referred` are SELLER (user) ids. Rows written before then held store ids; the two never collide, and the seller reads only
 * rows whose referrer is their own user id. monthsRewarded is written by the reward job (S8-B6).
 */
export interface IReferral extends Document {
  referrer: Types.ObjectId;
  referred: Types.ObjectId;
  status: 'pending' | 'rewarded';
  rewardType?: 'commission_discount' | 'platform_credit' | null;
  rewardValue?: number | null;
  rewardedAt?: Date | null;
  monthsRewarded: number;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    referrer: { type: Schema.Types.ObjectId, required: true, index: true },
    referred: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['pending', 'rewarded'], default: 'pending' },
    rewardType: { type: String, enum: ['commission_discount', 'platform_credit'], default: null },
    rewardValue: { type: Number, default: null },
    rewardedAt: { type: Date, default: null },
    monthsRewarded: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

ReferralSchema.index({ referred: 1 }, { unique: true });

export const Referral: Model<IReferral> =
  (mongoose.models.Referral as Model<IReferral> | undefined) ?? mongoose.model<IReferral>('Referral', ReferralSchema);
