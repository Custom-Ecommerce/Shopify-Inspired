import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: categories (apps/admin/src/collections/Categories.ts). Platform-wide: sellers read them, admins
 * write them. A slug is unique.
 */
export interface ICategory extends Document {
  name: string;
  slug: string;
  order: number;
  description?: string | null;
  banner?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    order: { type: Number, default: 0 },
    description: { type: String, default: null },
    banner: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

CategorySchema.index({ slug: 1 }, { unique: true });

export const Category: Model<ICategory> =
  (mongoose.models.Category as Model<ICategory> | undefined) ?? mongoose.model<ICategory>('Category', CategorySchema);
