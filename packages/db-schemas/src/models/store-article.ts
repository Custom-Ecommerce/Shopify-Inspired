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
  /** Sprint 7: the labels of the article (at most 10). */
  tags?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** Sprint 7: the version of the record, for the compare-and-set of an update. Rows from before it have none and read as 0. */
  revision?: number;
  /** Sprint 7: the media records the article uses (the cover and the images in the text). Written by the server only; the media registry reads it. */
  mediaRefs?: Types.ObjectId[];
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
    tags: { type: [String], default: [] },
    seoTitle: { type: String, maxlength: 70, default: null },
    seoDescription: { type: String, maxlength: 160, default: null },
    revision: { type: Number, min: 0, default: 0 },
    mediaRefs: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);

StoreArticleSchema.index({ store: 1, slug: 1 }, { unique: true });
// Sprint 7 (S7-B2): which articles use a media file (the media registry asks this before a file can be deleted).
StoreArticleSchema.index({ store: 1, mediaRefs: 1 });

export const StoreArticle: Model<IStoreArticle> =
  (mongoose.models.StoreArticle as Model<IStoreArticle> | undefined) ??
  mongoose.model<IStoreArticle>('StoreArticle', StoreArticleSchema);
