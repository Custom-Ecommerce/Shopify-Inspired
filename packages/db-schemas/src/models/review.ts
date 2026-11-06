import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: reviews (apps/admin/src/collections/Reviews.ts). New reviews start pending.
 */
export interface IReview extends Document {
  product: Types.ObjectId;
  store: Types.ObjectId;
  customer?: Types.ObjectId | null;
  order?: Types.ObjectId | null;
  rating: number;
  title?: string | null;
  body: string;
  images: Types.ObjectId[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    product: { type: Schema.Types.ObjectId, required: true, index: true },
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, default: null },
    order: { type: Schema.Types.ObjectId, default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: null },
    body: { type: String, required: true },
    images: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true },
);

export const Review: Model<IReview> =
  (mongoose.models.Review as Model<IReview> | undefined) ?? mongoose.model<IReview>('Review', ReviewSchema);
