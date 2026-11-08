import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: stockmovements. One stock change on one variant. History lives here so a product document does not grow
 * with every order. Written best effort: the conditional update on the variant is what protects the stock.
 */
export interface IStockMovement extends Document {
  store: Types.ObjectId;
  product: Types.ObjectId;
  variantId: Types.ObjectId;
  previousQuantity: number;
  quantity: number;
  delta: number;
  reason: string;
  changedAt: Date;
  /** Who made a manual change. Null for a change an order made. */
  actor?: Types.ObjectId | null;
  /** EP-02 (D-066): the order a placement, release or cancel movement belongs to. Missing on manual adjustments. */
  orderId?: Types.ObjectId;
}

const StockMovementSchema = new Schema<IStockMovement>({
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  previousQuantity: { type: Number, required: true },
  quantity: { type: Number, required: true },
  delta: { type: Number, required: true },
  reason: { type: String, required: true, trim: true },
  changedAt: { type: Date, required: true, default: () => new Date() },
  actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // No default: only order movements carry it.
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
});

// The history of one product, newest first.
StockMovementSchema.index({ store: 1, product: 1, changedAt: -1 });

// The movements of one order (D-066). Sparse and non-unique: most movements have no order, an order has one per line.
StockMovementSchema.index({ orderId: 1 }, { sparse: true });

export const StockMovement: Model<IStockMovement> =
  (mongoose.models.StockMovement as Model<IStockMovement> | undefined) ??
  mongoose.model<IStockMovement>('StockMovement', StockMovementSchema);
