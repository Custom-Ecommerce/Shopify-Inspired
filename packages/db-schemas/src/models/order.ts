import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/** Same option set as @markaz/contracts STOREFRONT_PAYMENT_METHODS. Keep them identical. */
export const ORDER_PAYMENT_METHODS = ['cod', 'card'] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'dispatched',
  'delivered',
  'cancelled',
  'returned',
] as const;

/**
 * Collection: orders (apps/admin/src/collections/Orders.ts).
 *
 * Part 7 adds what a storefront checkout writes: the customer (name, phone, address, city), the payment
 * method, an order group, and the idempotency key that makes a retried submission return the first order
 * instead of creating a second one.
 *
 * Every Part 7 field is optional at the schema level: orders written before it (analytics and the dashboard
 * read them) have none of these, and they must keep loading. The storefront route always sets them.
 */
export interface IOrderLine {
  productId: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
}

export interface IOrder extends Document {
  store: Types.ObjectId;
  orderId: string;
  /** Groups the orders one checkout produced. One per order until multi-store carts exist. */
  orderGroupId?: string | null;
  /** Client-generated per checkout attempt. Unique within a store. */
  idempotencyKey?: string | null;
  /** Hash of the request that created the order, so a reused key with a different body is detectable. */
  requestFingerprint?: string | null;
  status: (typeof ORDER_STATUSES)[number];
  paymentMethod?: OrderPaymentMethod | null;
  customerName?: string | null;
  /** E.164 for storefront orders. Older orders may hold a local format. */
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  items: IOrderLine[];
  subtotal: number;
  deliveryCharges: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: String, required: true },
    orderGroupId: { type: String, default: null },
    idempotencyKey: { type: String, trim: true, minlength: 8, maxlength: 128, default: undefined },
    requestFingerprint: { type: String, default: undefined },
    status: {
      type: String,
      required: true,
      enum: [...ORDER_STATUSES],
      default: 'pending',
    },
    paymentMethod: { type: String, enum: [...ORDER_PAYMENT_METHODS], default: undefined },
    customerName: { type: String, trim: true, maxlength: 80, default: null },
    phone: { type: String, trim: true, maxlength: 32, default: null },
    address: { type: String, trim: true, maxlength: 300, default: null },
    city: { type: String, trim: true, maxlength: 60, default: null },
    items: {
      type: [
        {
          productId: { type: String, required: true },
          productTitle: { type: String, required: true },
          unitPrice: { type: Number, required: true, min: 0 },
          quantity: { type: Number, required: true, min: 1 },
        },
      ],
      default: [],
    },
    subtotal: { type: Number, min: 0, default: 0 },
    deliveryCharges: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

// A human-facing order id is unique inside a store (lookup and the dashboard both address orders by it).
OrderSchema.index({ store: 1, orderId: 1 }, { unique: true });

// The idempotency guarantee. Partial, so the orders that predate the key (and have none) never collide.
OrderSchema.index(
  { store: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const Order: Model<IOrder> =
  (mongoose.models.Order as Model<IOrder> | undefined) ?? mongoose.model<IOrder>('Order', OrderSchema);
