import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: discounts. A code is unique per store and stored in capitals, so it is not case sensitive. New codes are
 * percentage or fixed_amount only (D-080); the other two types stay readable and no longer work at checkout.
 */
export interface IDiscount extends Document {
  store: Types.ObjectId;
  code: string;
  type: 'percentage' | 'fixed_amount' | 'free_delivery' | 'buy_x_get_y';
  value: number;
  minOrderAmount?: number | null;
  maxUses?: number | null;
  usedCount: number;
  startDate?: Date | null;
  endDate?: Date | null;
  applicableProducts: Types.ObjectId[];
  isActive: boolean;
  /** Set when the seller archives the code. It then stops working; past orders keep their own snapshot. */
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DiscountSchema = new Schema<IDiscount>(
  {
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    type: {
      type: String,
      required: true,
      enum: ['percentage', 'fixed_amount', 'free_delivery', 'buy_x_get_y'],
    },
    value: { type: Number, required: true, min: 0 },
    minOrderAmount: { type: Number, min: 0, default: null },
    maxUses: { type: Number, min: 0, default: null },
    usedCount: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    applicableProducts: { type: [Schema.Types.ObjectId], default: [] },
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DiscountSchema.index({ store: 1, code: 1 }, { unique: true });

export const Discount: Model<IDiscount> =
  (mongoose.models.Discount as Model<IDiscount> | undefined) ?? mongoose.model<IDiscount>('Discount', DiscountSchema);
