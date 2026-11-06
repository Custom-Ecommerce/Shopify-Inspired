import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export interface IArchivedReviewProduct {
  title: string;
  slug: string;
  store: Types.ObjectId;
}

/**
 * Collection: archivedreviews. What is kept of a review when its product is permanently deleted (D-014, A-004): the
 * rating, the text, the date and a snapshot of the product, for later analytics. It has no customer, no order and no
 * images, so nothing here points back at a shopper. _id is the id the review had, so archiving twice writes one row.
 */
export interface IArchivedReview extends Document<Types.ObjectId> {
  rating: number;
  title?: string | null;
  body: string;
  /** When the shopper wrote it. */
  reviewedAt: Date;
  product: IArchivedReviewProduct;
  archivedAt: Date;
}

const ArchivedReviewSchema = new Schema<IArchivedReview>({
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, default: null },
  body: { type: String, required: true },
  reviewedAt: { type: Date, required: true },
  product: {
    type: new Schema<IArchivedReviewProduct>(
      {
        title: { type: String, required: true },
        slug: { type: String, required: true },
        store: { type: Schema.Types.ObjectId, required: true },
      },
      { _id: false },
    ),
    required: true,
  },
  archivedAt: { type: Date, required: true, default: () => new Date() },
});

ArchivedReviewSchema.index({ 'product.store': 1, reviewedAt: -1 });

export const ArchivedReview: Model<IArchivedReview> =
  (mongoose.models.ArchivedReview as Model<IArchivedReview> | undefined) ??
  mongoose.model<IArchivedReview>('ArchivedReview', ArchivedReviewSchema);
