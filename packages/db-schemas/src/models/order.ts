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
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** EP-02 US07: cash on delivery only. An order that has no paymentStatus (written before EP-02) reads as unpaid. */
export const ORDER_PAYMENT_STATUSES = ['unpaid', 'collected'] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

/** Field limits shared with the routes that will write these fields (EP-02 OB-2..OB-5). */
export const ORDER_NOTE_MAX = 1000;
export const ORDER_STATUS_NOTE_MAX = 500;
export const ORDER_CANCEL_REASON_MAX = 500;
export const ORDER_COURIER_MAX = 60;
export const ORDER_TRACKING_NUMBER_MAX = 64;
export const ORDER_TRACKING_URL_MAX = 500;

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
  variantId: string;
  productTitle: string;
  /** "Default" for a product with no options. */
  variantTitle: string;
  sku?: string | null;
  unitPrice: number;
  quantity: number;
}

/** One status change (EP-02 US02). A tracking-number edit after dispatch is recorded as from = to = dispatched. */
export interface IOrderStatusChange {
  from: OrderStatus;
  to: OrderStatus;
  /** The user who made the change. */
  by: Types.ObjectId;
  at: Date;
  note?: string | null;
}

/** An internal seller note (EP-02 US06). Never shown to the customer. */
export interface IOrderNote {
  text: string;
  by: Types.ObjectId;
  at: Date;
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
  /*
   * EP-02 fields. All have defaults, so an order written before EP-02 still loads: a hydrated document gets the
   * defaults, while a .lean() read simply lacks the field and must treat it as the default (no history, no notes,
   * unpaid, no courier).
   */
  /** Every status change, oldest first as written; the UI shows it newest first. */
  statusHistory: IOrderStatusChange[];
  courier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  paymentStatus: OrderPaymentStatus;
  collectedAt?: Date | null;
  collectedAmount?: number | null;
  /** Internal seller notes. Never part of a storefront response. */
  notes: IOrderNote[];
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const OrderStatusChangeSchema = new Schema<IOrderStatusChange>(
  {
    from: { type: String, required: true, enum: [...ORDER_STATUSES] },
    to: { type: String, required: true, enum: [...ORDER_STATUSES] },
    by: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    note: { type: String, trim: true, maxlength: ORDER_STATUS_NOTE_MAX, default: null },
  },
  { _id: false },
);

const OrderNoteSchema = new Schema<IOrderNote>({
  text: { type: String, required: true, trim: true, minlength: 1, maxlength: ORDER_NOTE_MAX },
  by: { type: Schema.Types.ObjectId, required: true },
  at: { type: Date, required: true, default: () => new Date() },
});

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
          variantId: { type: String, required: true },
          productTitle: { type: String, required: true },
          variantTitle: { type: String, required: true },
          sku: { type: String, default: null },
          unitPrice: { type: Number, required: true, min: 0 },
          quantity: { type: Number, required: true, min: 1 },
        },
      ],
      default: [],
    },
    subtotal: { type: Number, min: 0, default: 0 },
    deliveryCharges: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
    statusHistory: { type: [OrderStatusChangeSchema], default: [] },
    courier: { type: String, trim: true, maxlength: ORDER_COURIER_MAX, default: null },
    trackingNumber: { type: String, trim: true, maxlength: ORDER_TRACKING_NUMBER_MAX, default: null },
    trackingUrl: { type: String, trim: true, maxlength: ORDER_TRACKING_URL_MAX, default: null },
    paymentStatus: { type: String, required: true, enum: [...ORDER_PAYMENT_STATUSES], default: 'unpaid' },
    collectedAt: { type: Date, default: null },
    collectedAmount: { type: Number, min: 0, default: null },
    notes: { type: [OrderNoteSchema], default: [] },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, maxlength: ORDER_CANCEL_REASON_MAX, default: null },
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

// EP-02 seller order list. None of these is unique, so building them on an existing collection cannot fail on data.
// The "All" tab: one store, newest first.
OrderSchema.index({ store: 1, createdAt: -1 });
// A status tab: one store, one status, newest first. The per-status counts also read this index.
OrderSchema.index({ store: 1, status: 1, createdAt: -1 });
// Search inside one store. Phone is stored in E.164, so an exact or anchored-prefix match is an index range. A name
// search is a case-insensitive regex: it scans this index's keys for the one store only, never other stores' orders.
OrderSchema.index({ store: 1, phone: 1 });
OrderSchema.index({ store: 1, customerName: 1 });

export const Order: Model<IOrder> =
  (mongoose.models.Order as Model<IOrder> | undefined) ?? mongoose.model<IOrder>('Order', OrderSchema);
