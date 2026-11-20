import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const ABANDONED_CART_STATUSES = ['open', 'contacted', 'recovered', 'expired'] as const;
export type AbandonedCartStatusValue = (typeof ABANDONED_CART_STATUSES)[number];
/** Same limits as ABANDONED_CART_ITEMS_MAX and ABANDONED_CART_TTL_DAYS in @markaz/contracts. Keep them identical. */
export const ABANDONED_CART_ITEMS_LIMIT = 50;
export const ABANDONED_CART_TTL_DAYS_VALUE = 7;

export interface IAbandonedCartItem {
  productId: Types.ObjectId;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Collection: abandonedcarts (Sprint 5 EP-28.US01, D-107). A cart a shopper left behind after typing a valid phone and seeing the consent line.
 * Nothing is stored without both. The items are a SNAPSHOT priced by the server from the product ids (names, quantities and unit prices, at
 * most 50 lines); total is the value of the items in whole rupees (delivery not included), also computed by the server.
 *
 * One OPEN cart per store and phone (the partial unique index below decides a race). A cart the seller has contacted keeps being refreshed
 * by the shopper's later activity but stays contacted. An order with the same phone key marks the open or contacted cart recovered, with
 * the order id. expiresAt is lastSeenAt + 7 days and a TTL index deletes the cart then (a recovered cart is kept for those days too).
 */
export interface IAbandonedCart {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  /** Normalized, +923xxxxxxxxx: the same key as Order.phoneKey. */
  phone: string;
  email?: string | null;
  items: IAbandonedCartItem[];
  total: number;
  status: AbandonedCartStatusValue;
  /** When the shopper saw the consent line and the cart was first kept. */
  consentAt: Date;
  contactedAt?: Date | null;
  recoveredOrder?: Types.ObjectId | null;
  recoveredAt?: Date | null;
  lastSeenAt: Date;
  /** When the one automatic email was queued (null: never). */
  emailQueuedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<IAbandonedCartItem>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    variantId: { type: String, required: true, maxlength: 64 },
    productTitle: { type: String, required: true, maxlength: 200 },
    variantTitle: { type: String, default: '', maxlength: 200 },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const AbandonedCartSchema = new Schema<IAbandonedCart>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    phone: { type: String, required: true, trim: true, match: /^\+923\d{9}$/ },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    items: {
      type: [ItemSchema],
      default: [],
      validate: { validator: (items: unknown[]) => items.length >= 1 && items.length <= ABANDONED_CART_ITEMS_LIMIT, message: 'A cart keeps 1 to 50 lines.' },
    },
    total: { type: Number, required: true, min: 0 },
    status: { type: String, enum: [...ABANDONED_CART_STATUSES], default: 'open' },
    consentAt: { type: Date, required: true },
    contactedAt: { type: Date, default: null },
    recoveredOrder: { type: Schema.Types.ObjectId, default: null },
    recoveredAt: { type: Date, default: null },
    lastSeenAt: { type: Date, required: true },
    emailQueuedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'abandonedcarts', timestamps: true },
);

// One OPEN cart per store and phone. Partial, so a contacted, recovered or expired cart of the same phone never blocks a new open one.
AbandonedCartSchema.index({ store: 1, phone: 1 }, { unique: true, name: 'store_phone_open_unique', partialFilterExpression: { status: 'open' } });
// The 7 day TTL: MongoDB deletes the cart when expiresAt passes (expireAfterSeconds 0, because expiresAt already holds lastSeenAt + 7 days).
AbandonedCartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });
// The seller's list by status, newest activity first, and the order lookup that marks a cart recovered.
AbandonedCartSchema.index({ store: 1, status: 1, lastSeenAt: -1 });
// The optional email step: open carts with an email that have not been emailed yet.
AbandonedCartSchema.index({ status: 1, emailQueuedAt: 1, lastSeenAt: 1 });

export const AbandonedCart: Model<IAbandonedCart> =
  (mongoose.models.AbandonedCart as Model<IAbandonedCart> | undefined) ?? mongoose.model<IAbandonedCart>('AbandonedCart', AbandonedCartSchema);
