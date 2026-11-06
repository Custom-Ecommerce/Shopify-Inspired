import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: storeArticles (apps/admin/src/collections/StoreArticles.ts). A slug is unique per store.
 */
export interface IStoreArticle extends Document {
  store: Types.ObjectId;
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: unknown;
  coverImage?: Types.ObjectId | null;
  type: 'blog' | 'lookbook' | 'size_guide' | 'care_instructions';
  status: 'draft' | 'published' | 'archived';
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const StoreArticleSchema = new Schema<IStoreArticle>(
  {
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    excerpt: { type: String, maxlength: 160, default: null },
    content: { type: Schema.Types.Mixed, default: null },
    coverImage: { type: Schema.Types.ObjectId, default: null },
    type: { type: String, enum: ['blog', 'lookbook', 'size_guide', 'care_instructions'], default: 'blog' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

StoreArticleSchema.index({ store: 1, slug: 1 }, { unique: true });

export const StoreArticle: Model<IStoreArticle> =
  (mongoose.models.StoreArticle as Model<IStoreArticle> | undefined) ??
  mongoose.model<IStoreArticle>('StoreArticle', StoreArticleSchema);
