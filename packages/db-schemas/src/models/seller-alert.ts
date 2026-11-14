import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const SELLER_ALERT_KINDS = ['new_order', 'low_stock', 'out_of_stock'] as const;
export type SellerAlertKind = (typeof SELLER_ALERT_KINDS)[number];

/**
 * Collection: selleralerts (EP-07.US03). The in-app alerts behind the dashboard bell, one store each.
 *
 * dedupeKey + open: while an alert is open, a second one with the same key cannot be written (the partial unique index
 * below). A new-order alert stays open for good, so an order alerts once. A stock alert is closed (open false,
 * resolvedAt set) when the stock rises above the threshold again, so a later drop can alert again.
 */
export interface ISellerAlert {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  kind: SellerAlertKind;
  title: string;
  body: string;
  /** A dashboard path (e.g. /orders/<id>), never an external address. */
  link: string | null;
  readAt: Date | null;
  dedupeKey?: string;
  open: boolean;
  resolvedAt: Date | null;
  order?: Types.ObjectId | null;
  product?: Types.ObjectId | null;
  variantId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SellerAlertSchema = new Schema<ISellerAlert>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    kind: { type: String, enum: [...SELLER_ALERT_KINDS], required: true },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, default: '', maxlength: 500 },
    link: { type: String, default: null, maxlength: 300 },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, maxlength: 200 },
    open: { type: Boolean, required: true, default: true },
    resolvedAt: { type: Date, default: null },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    variantId: { type: String, default: null },
  },
  { timestamps: true, collection: 'selleralerts' },
);

// The bell list is newest first per store; the unread count filters on readAt.
SellerAlertSchema.index({ store: 1, createdAt: -1, _id: -1 });
SellerAlertSchema.index({ store: 1, readAt: 1 });
// One OPEN alert per store and key. Closed alerts keep their key and do not block a new one.
SellerAlertSchema.index(
  { store: 1, dedupeKey: 1 },
  { unique: true, name: 'store_dedupeKey_open_unique', partialFilterExpression: { open: true, dedupeKey: { $type: 'string' } } },
);

export const SellerAlert: Model<ISellerAlert> =
  (mongoose.models.SellerAlert as Model<ISellerAlert> | undefined) ??
  mongoose.model<ISellerAlert>('SellerAlert', SellerAlertSchema);
