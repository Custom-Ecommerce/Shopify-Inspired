import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: referrals (apps/admin/src/collections/Referrals.ts). A store can be referred once.
 */
export interface IReferral extends Document {
  referrer: Types.ObjectId;
  referred: Types.ObjectId;
  status: 'pending' | 'rewarded';
  rewardType?: 'commission_discount' | 'platform_credit' | null;
  rewardValue?: number | null;
  rewardedAt?: Date | null;
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
  },
  { timestamps: true },
);

ReferralSchema.index({ referred: 1 }, { unique: true });

export const Referral: Model<IReferral> =
  (mongoose.models.Referral as Model<IReferral> | undefined) ?? mongoose.model<IReferral>('Referral', ReferralSchema);
