import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/** Same option set as @markaz/contracts STOCK_STATUSES. Keep them identical. */
export const PRODUCT_STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock'] as const;

export interface IProductHighlight {
  text: string;
}

export interface IProductStockHistoryEntry {
  quantity?: number | null;
  previousQuantity?: number | null;
  reason?: string | null;
  changedAt?: Date | null;
}

/**
 * Collection: products. Store-scoped catalog item. Field for field it follows productSchema in
 * @markaz/contracts, and it carries everything StorefrontProductSummary and StorefrontProductDetail
 * project: the first media entry is the primary image, categories are populated into
 * { id, slug, name }, and price, originalPrice, stockStatus, avgRating and reviewCount pass through.
 *
 * Additions beyond the admin contract: isPublished (the storefront only serves published products),
 * tags and deliveryCharge (the detail projection reads them).
 */
export interface IProduct extends Document {
  store: Types.ObjectId;
  title: string;
  slug: string;
  categories: Types.ObjectId[];
  media: Types.ObjectId[];
  description?: string | null;
  highlights: IProductHighlight[];
  tags: string[];
  price: number;
  originalPrice?: number | null;
  deliveryCharge?: number | null;
  stockStatus: (typeof PRODUCT_STOCK_STATUSES)[number];
  stockQuantity: number;
  stockHistory: IProductStockHistoryEntry[];
  isFeatured: boolean;
  isPublished: boolean;
  lowStockThreshold?: number | null;
  reservedQuantity: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoImage?: Types.ObjectId | null;
  avgRating: number;
  reviewCount: number;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const isWholeNumber = (value: number | null | undefined): boolean =>
  value === null || value === undefined || Number.isInteger(value);

const wholeNumber = { validator: isWholeNumber, message: '{PATH} must be a whole number' };

const HighlightSchema = new Schema<IProductHighlight>(
  { text: { type: String, required: true, trim: true, minlength: 1 } },
  { _id: false },
);

const StockHistorySchema = new Schema<IProductStockHistoryEntry>(
  {
    quantity: { type: Number, default: null },
    previousQuantity: { type: Number, default: null },
    reason: { type: String, default: null },
    changedAt: { type: Date, default: null },
  },
  { _id: false },
);

const ProductSchema = new Schema<IProduct>(
  {
    store: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true, minlength: 1, maxlength: 200 },
    categories: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
      default: [],
      validate: {
        validator: (value: unknown[]) => Array.isArray(value) && value.length >= 1,
        message: 'a product needs at least one category',
      },
    },
    media: { type: [{ type: Schema.Types.ObjectId, ref: 'Media' }], default: [] },
    description: { type: String, default: null },
    highlights: { type: [HighlightSchema], default: [] },
    tags: { type: [{ type: String, trim: true }], default: [] },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0, default: null },
    deliveryCharge: { type: Number, min: 0, default: null },
    stockStatus: { type: String, enum: [...PRODUCT_STOCK_STATUSES], required: true, default: 'in_stock' },
    stockQuantity: { type: Number, required: true, min: 0, default: 0, validate: wholeNumber },
    stockHistory: { type: [StockHistorySchema], default: [] },
    isFeatured: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: true },
    lowStockThreshold: { type: Number, min: 0, default: null, validate: wholeNumber },
    reservedQuantity: { type: Number, min: 0, default: 0, validate: wholeNumber },
    seoTitle: { type: String, default: null },
    seoDescription: { type: String, default: null },
    seoImage: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    avgRating: { type: Number, min: 0, max: 5, default: 0 },
    reviewCount: { type: Number, min: 0, default: 0, validate: wholeNumber },
    viewCount: { type: Number, min: 0, default: 0, validate: wholeNumber },
  },
  { timestamps: true, collection: 'products' },
);

// A slug is unique inside a store, not across the platform.
ProductSchema.index({ store: 1, slug: 1 }, { unique: true });
// Catalog listing: every storefront query is store + published, then one sort.
ProductSchema.index({ store: 1, isPublished: 1, createdAt: -1, _id: -1 });
ProductSchema.index({ store: 1, isPublished: 1, categories: 1, createdAt: -1 });
ProductSchema.index({ store: 1, isPublished: 1, price: 1, _id: 1 });
ProductSchema.index({ store: 1, isPublished: 1, avgRating: -1, reviewCount: -1, _id: -1 });

export const Product: Model<IProduct> =
  (mongoose.models.Product as Model<IProduct> | undefined) ??
  mongoose.model<IProduct>('Product', ProductSchema, 'products');
