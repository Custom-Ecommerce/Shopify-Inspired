import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/** Same limits as the review contract in @markaz/contracts. Keep them identical. */
export const REVIEW_BODY_MAX = 1000;
export const REVIEW_TITLE_MAX = 80;
export const REVIEW_DISPLAY_NAME_MAX = 40;
export const REVIEW_REPLY_MAX = 500;
export const REVIEW_HIDDEN_REASON_MAX = 300;

/**
 * Collection: reviews (apps/admin/src/collections/Reviews.ts).
 *
 * Sprint 5 EP-21 (D-107, D-108): a review is written by a shopper of a DELIVERED order, through the public review route, and is published at
 * once. The status values keep their meaning: approved = shown on the storefront (what a new review starts as), rejected = hidden by an admin
 * (with hiddenReason), pending is no longer used. One review per order and product (a line is a product plus a variant, and the variants of one
 * product share one review). The seller answers with one editable reply. Plain text only: no HTML is stored, and every output escapes it.
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
  /** The name the shopper chose to show, up to 40 characters. Never the account name, phone or email. */
  displayName?: string | null;
  /** True when the review came through a delivered order. Every review written by the public route is verified. */
  verified: boolean;
  /** The seller's one reply: written once, editable. */
  reply?: { text: string; at: Date; editedAt?: Date | null } | null;
  /** Why an admin hid it (status rejected), and who and when. Cleared when it is shown again. */
  hiddenReason?: string | null;
  hiddenAt?: Date | null;
  hiddenBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ReplySchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: REVIEW_REPLY_MAX },
    at: { type: Date, required: true },
    editedAt: { type: Date, default: null },
  },
  { _id: false },
);

const ReviewSchema = new Schema<IReview>(
  {
    product: { type: Schema.Types.ObjectId, required: true, index: true },
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, default: null },
    order: { type: Schema.Types.ObjectId, default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: null, maxlength: REVIEW_TITLE_MAX },
    body: { type: String, required: true, maxlength: REVIEW_BODY_MAX },
    images: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    displayName: { type: String, trim: true, maxlength: REVIEW_DISPLAY_NAME_MAX, default: null },
    verified: { type: Boolean, default: false },
    reply: { type: ReplySchema, default: null },
    hiddenReason: { type: String, trim: true, maxlength: REVIEW_HIDDEN_REASON_MAX, default: null },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

// One review per order and product. Partial, so a review without an order (older rows) never collides; this index is what makes the
// public route race-safe (the loser of two parallel posts gets the duplicate key and answers "already reviewed").
ReviewSchema.index({ order: 1, product: 1 }, { unique: true, name: 'order_product_unique', partialFilterExpression: { order: { $type: 'objectId' } } });
// The seller's list (status tabs, newest first) and the storefront's list of one product (approved only, newest first).
ReviewSchema.index({ store: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ product: 1, status: 1, createdAt: -1 });

export const Review: Model<IReview> =
  (mongoose.models.Review as Model<IReview> | undefined) ?? mongoose.model<IReview>('Review', ReviewSchema);
