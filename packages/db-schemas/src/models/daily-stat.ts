import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** The same value as STAT_RETENTION_DAYS in @markaz/contracts (this package depends on mongoose only). */
export const STAT_MODEL_RETENTION_DAYS = 400;

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sprint 8 (S8-B6, D-118): anonymous first-party counters. No cookie, no visitor id, no IP, no personal data: only numbers per store and UTC day.
 *
 *   dailystats         one row per store and day: visits, productViews, addToCart, checkoutStarts, orders
 *   productdailystats  one row per store, product slug and day: views (at most 500 different slugs per store and day, held by the writer)
 *
 * expiresAt is a real date, set when the row is made (the day plus 400 days): the TTL index removes the row. The unique and TTL indexes are declared here, so
 * scripts/ensure-indexes.mjs creates them (the backends build no index at runtime).
 */
export interface IDailyStat {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  /** UTC "YYYY-MM-DD". */
  day: string;
  visits: number;
  productViews: number;
  addToCart: number;
  checkoutStarts: number;
  orders: number;
  expiresAt: Date;
}

export interface IProductDailyStat {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  productSlug: string;
  day: string;
  views: number;
  expiresAt: Date;
}

const counter = { type: Number, default: 0, min: 0 } as const;

const DailyStatSchema = new Schema<IDailyStat>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    day: { type: String, required: true, match: DAY_SHAPE },
    visits: counter,
    productViews: counter,
    addToCart: counter,
    checkoutStarts: counter,
    orders: counter,
    expiresAt: { type: Date, required: true },
  },
  { collection: 'dailystats', bufferCommands: false, versionKey: false },
);
DailyStatSchema.index({ store: 1, day: 1 }, { unique: true, name: 'store_day_unique' });
// S8-B7: the admin overview sums the platform's last days.
DailyStatSchema.index({ day: 1 }, { name: 'day' });
DailyStatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

const ProductDailyStatSchema = new Schema<IProductDailyStat>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    productSlug: { type: String, required: true, maxlength: 200 },
    day: { type: String, required: true, match: DAY_SHAPE },
    views: counter,
    expiresAt: { type: Date, required: true },
  },
  { collection: 'productdailystats', bufferCommands: false, versionKey: false },
);
ProductDailyStatSchema.index({ store: 1, productSlug: 1, day: 1 }, { unique: true, name: 'store_slug_day_unique' });
// The count of a day's products (the cap) and the range read of the analytics.
ProductDailyStatSchema.index({ store: 1, day: 1 }, { name: 'store_day' });
ProductDailyStatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

export const DailyStat: Model<IDailyStat> = (mongoose.models.DailyStat as Model<IDailyStat> | undefined) ?? mongoose.model<IDailyStat>('DailyStat', DailyStatSchema);
export const ProductDailyStat: Model<IProductDailyStat> =
  (mongoose.models.ProductDailyStat as Model<IProductDailyStat> | undefined) ?? mongoose.model<IProductDailyStat>('ProductDailyStat', ProductDailyStatSchema);
