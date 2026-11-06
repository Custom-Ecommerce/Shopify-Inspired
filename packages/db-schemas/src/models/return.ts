import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: returns (apps/admin/src/collections/Returns.ts). Sellers change the status and the refund fields
 * only, through the transition table in the contracts.
 */
export interface IReturn extends Document {
  order: Types.ObjectId;
  store: Types.ObjectId;
  customer?: Types.ObjectId | null;
  reason: 'damaged' | 'wrong_item' | 'changed_mind' | 'other';
  description?: string | null;
  images: Types.ObjectId[];
  status: 'requested' | 'approved' | 'rejected' | 'completed';
  refundType?: 'store_credit' | 'cod_refund' | 'replacement' | null;
  refundAmount?: number | null;
  adminNotes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ReturnSchema = new Schema<IReturn>(
  {
    order: { type: Schema.Types.ObjectId, required: true, index: true },
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, required: true, enum: ['damaged', 'wrong_item', 'changed_mind', 'other'] },
    description: { type: String, default: null },
    images: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ['requested', 'approved', 'rejected', 'completed'], default: 'requested' },
    refundType: { type: String, enum: ['store_credit', 'cod_refund', 'replacement'], default: null },
    refundAmount: { type: Number, min: 0, default: null },
    adminNotes: { type: String, default: null },
  },
  { timestamps: true },
);

export const Return: Model<IReturn> =
  (mongoose.models.Return as Model<IReturn> | undefined) ?? mongoose.model<IReturn>('Return', ReturnSchema);
