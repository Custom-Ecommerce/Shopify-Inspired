import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: referrals (apps/admin/src/collections/Referrals.ts). A seller can be referred once.
 *
 * Sprint 8 (S8-B5, D-118): `referrer` and `referred` are SELLER (user) ids. Rows written before then held store ids; the two never collide, and the seller reads only
 * rows whose referrer is their own user id.
 *
 * Sprint 8 (S8-B6): pending -> rewarded | capped | refused, ONCE, by a compare-and-set on status pending. A capped row is not rewarded later. rewardMonth (UTC
 * "YYYY-MM") and rewardSlot (1..cap) are unique per referrer, so two rewards at once can never both take the last place of the month. rewardPayment is the
 * referred seller's payment that earned it; paymentVoidedAt is set when that payment was voided afterwards (the reward is NOT taken back by code).
 */
export interface IReferral extends Document {
  referrer: Types.ObjectId;
  referred: Types.ObjectId;
  status: 'pending' | 'rewarded' | 'capped' | 'refused';
  rewardType?: 'commission_discount' | 'platform_credit' | null;
  rewardValue?: number | null;
  rewardedAt?: Date | null;
  monthsRewarded: number;
  rewardMonth?: string;
  rewardSlot?: number;
  rewardPayment?: Types.ObjectId | null;
  paymentVoidedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    referrer: { type: Schema.Types.ObjectId, required: true, index: true },
    referred: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['pending', 'rewarded', 'capped', 'refused'], default: 'pending' },
    rewardType: { type: String, enum: ['commission_discount', 'platform_credit'], default: null },
    rewardValue: { type: Number, default: null },
    rewardedAt: { type: Date, default: null },
    monthsRewarded: { type: Number, default: 0, min: 0 },
    rewardMonth: { type: String, match: /^\d{4}-\d{2}$/ },
    rewardSlot: { type: Number, min: 1 },
    rewardPayment: { type: Schema.Types.ObjectId, default: null },
    paymentVoidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ReferralSchema.index({ referred: 1 }, { unique: true });
ReferralSchema.index({ referrer: 1, rewardMonth: 1, rewardSlot: 1 }, { unique: true, name: 'referrer_month_slot_unique', partialFilterExpression: { rewardSlot: { $type: 'number' } } });
// S8-B6: the admin's list, newest first, by status.
ReferralSchema.index({ status: 1, createdAt: -1 }, { name: 'status_createdAt' });

export const Referral: Model<IReferral> =
  (mongoose.models.Referral as Model<IReferral> | undefined) ?? mongoose.model<IReferral>('Referral', ReferralSchema);
