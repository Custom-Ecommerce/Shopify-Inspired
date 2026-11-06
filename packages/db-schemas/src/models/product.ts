import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export const PRODUCT_MAX_OPTIONS = 3;
export const PRODUCT_MAX_VARIANTS = 100;

export interface IProductHighlight {
  text: string;
}

export interface IProductOption {
  name: string;
  values: string[];
}

/** One sellable version of a product. Price and stock live here, never on the product. */
export interface IProductVariant {
  _id: Types.ObjectId;
  title: string;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  compareAtPrice?: number | null;
  trackQuantity: boolean;
  stockQuantity: number;
  lowStockThreshold?: number | null;
  optionValues: string[];
  imageId?: Types.ObjectId | null;
  position: number;
}

/** Who moved a product to trash. An admin's delete is not the seller's to undo. */
export interface IProductDeletedBy {
  user: Types.ObjectId;
  role: 'seller' | 'admin';
}

/**
 * Collection: products. Store-scoped catalog item in the Shopify model: options, and at least one variant. A product
 * with no options has exactly one variant, the Default. Availability is derived on read from the variants, so atomic
 * stock updates cannot drift from it. minPrice is the one denormalised value, so a listing can sort and index by price.
 */
export interface IProduct extends Document {
  store: Types.ObjectId;
  title: string;
  slug: string;
  categories: Types.ObjectId[];
  media: Types.ObjectId[];
  /** Video media, in the seller's order. */
  videos: Types.ObjectId[];
  description?: string | null;
  highlights: IProductHighlight[];
  tags: string[];
  options: IProductOption[];
  variants: IProductVariant[];
  minPrice: number;
  deliveryCharge?: number | null;
  isFeatured: boolean;
  isPublished: boolean;
  /** The sample product seeded with a new store. Never Live; the seller's first edit clears it. */
  isDemo: boolean;
  /** The seller's choice: leave Live lists and category counts while out of stock. The product page stays reachable. */
  hideWhenOutOfStock: boolean;
  /** Set while the product is in trash. Every query outside the trash view excludes it. */
  deletedAt?: Date | null;
  deletedBy?: IProductDeletedBy | null;
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

const OptionSchema = new Schema<IProductOption>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    values: {
      type: [{ type: String, trim: true, minlength: 1, maxlength: 60 }],
      validate: {
        validator: (value: string[]) => value.length >= 1 && value.length <= 50,
        message: 'an option has 1 to 50 values',
      },
    },
  },
  { _id: false },
);

const VariantSchema = new Schema<IProductVariant>({
  title: { type: String, required: true, trim: true },
  sku: { type: String, trim: true, maxlength: 64, default: null },
  barcode: { type: String, trim: true, maxlength: 64, default: null },
  price: { type: Number, required: true, min: 0, validate: wholeNumber },
  compareAtPrice: {
    type: Number,
    min: 0,
    default: null,
    validate: [
      wholeNumber,
      {
        validator(this: IProductVariant, value: number | null): boolean {
          return value === null || value === undefined || value > this.price;
        },
        message: 'the compare-at price must be higher than the price',
      },
    ],
  },
  trackQuantity: { type: Boolean, default: true },
  stockQuantity: { type: Number, required: true, min: 0, default: 0, validate: wholeNumber },
  lowStockThreshold: { type: Number, min: 0, default: null, validate: wholeNumber },
  optionValues: { type: [{ type: String, trim: true }], default: [] },
  imageId: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
  position: { type: Number, required: true, min: 0, default: 0, validate: wholeNumber },
});

/** A last line of defence. The seller backend's write path checks all of this first, with better messages. */
function variantsMatchOptions(this: IProduct, variants: IProductVariant[]): boolean {
  const options = this.options ?? [];
  if (options.length === 0 && variants.length !== 1) return false;
  const combinations = new Set<string>();
  for (const variant of variants) {
    const values = [...variant.optionValues];
    if (values.length !== options.length) return false;
    if (!values.every((value, index) => options[index].values.includes(value))) return false;
    combinations.add(JSON.stringify(values));
  }
  return combinations.size === variants.length;
}

const DeletedBySchema = new Schema<IProductDeletedBy>(
  {
    user: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['seller', 'admin'], required: true },
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
    videos: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
      default: [],
      validate: { validator: (value: unknown[]) => value.length <= 4, message: 'a product has at most 4 videos' },
    },
    description: { type: String, default: null },
    highlights: { type: [HighlightSchema], default: [] },
    tags: { type: [{ type: String, trim: true }], default: [] },
    options: {
      type: [OptionSchema],
      default: [],
      validate: {
        validator: (value: IProductOption[]) => {
          if (value.length > PRODUCT_MAX_OPTIONS) return false;
          return new Set(value.map((option) => option.name.toLowerCase())).size === value.length;
        },
        message: 'a product has at most 3 options, each with its own name',
      },
    },
    variants: {
      type: [VariantSchema],
      default: [],
      validate: [
        {
          validator: (value: IProductVariant[]) => value.length >= 1 && value.length <= PRODUCT_MAX_VARIANTS,
          message: 'a product has 1 to 100 variants',
        },
        {
          validator: variantsMatchOptions,
          message: 'the variants do not match the options',
        },
      ],
    },
    minPrice: { type: Number, required: true, min: 0, default: 0, validate: wholeNumber },
    deliveryCharge: { type: Number, min: 0, default: null, validate: wholeNumber },
    isFeatured: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
    hideWhenOutOfStock: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: DeletedBySchema, default: null },
    seoTitle: { type: String, default: null },
    seoDescription: { type: String, default: null },
    seoImage: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    avgRating: { type: Number, min: 0, max: 5, default: 0 },
    reviewCount: { type: Number, min: 0, default: 0, validate: wholeNumber },
    viewCount: { type: Number, min: 0, default: 0, validate: wholeNumber },
  },
  { timestamps: true, collection: 'products' },
);

// A document written through save() can never disagree with its variants. Writes that bypass save() must set minPrice
// themselves: the seller backend's product write path does.
ProductSchema.pre('validate', function setMinPrice(next) {
  if (this.variants.length > 0) this.minPrice = Math.min(...this.variants.map((variant) => variant.price));
  next();
});

// A slug is unique inside a store, not across the platform.
ProductSchema.index({ store: 1, slug: 1 }, { unique: true });
// Catalog listing: every storefront query is store + published, then one sort.
ProductSchema.index({ store: 1, isPublished: 1, createdAt: -1, _id: -1 });
ProductSchema.index({ store: 1, isPublished: 1, categories: 1, createdAt: -1 });
ProductSchema.index({ store: 1, isPublished: 1, minPrice: 1, _id: 1 });
ProductSchema.index({ store: 1, isPublished: 1, avgRating: -1, reviewCount: -1, _id: -1 });
// The trash view of one store. Only trashed products are in this index, so it stays small.
ProductSchema.index({ store: 1, deletedAt: 1 }, { partialFilterExpression: { deletedAt: { $type: 'date' } } });
// Finds who holds a SKU. This does NOT enforce uniqueness: a unique index over an embedded array cannot, because it
// says nothing about two entries in one document, and the null SKUs of a document would clash with those of another.
// Uniqueness is enforced by the write path. See apps/seller/backend/src/lib/product-variants.ts.
ProductSchema.index({ store: 1, 'variants.sku': 1 }, { partialFilterExpression: { 'variants.sku': { $type: 'string' } } });

export const Product: Model<IProduct> =
  (mongoose.models.Product as Model<IProduct> | undefined) ??
  mongoose.model<IProduct>('Product', ProductSchema, 'products');
