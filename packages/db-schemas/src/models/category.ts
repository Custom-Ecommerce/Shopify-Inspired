import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: categories. Store-scoped and seller-owned: a seller creates, edits, and deletes the categories of their
 * own store, and a slug is unique inside a store, not across the platform.
 *
 * isDemo marks the category seeded with a new store. The seller's first edit clears it.
 */
export interface ICategory extends Document {
  store: Types.ObjectId;
  name: string;
  slug: string;
  order: number;
  description?: string | null;
  banner?: Types.ObjectId | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    order: { type: Number, default: 0 },
    description: { type: String, default: null },
    banner: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// A slug is unique inside a store, not across the platform.
CategorySchema.index({ store: 1, slug: 1 }, { unique: true });
// The seller's list and the storefront's list: one store, by order then name.
CategorySchema.index({ store: 1, order: 1, name: 1 });

export const Category: Model<ICategory> =
  (mongoose.models.Category as Model<ICategory> | undefined) ?? mongoose.model<ICategory>('Category', CategorySchema);
