import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/** Same values as RETURN_REASONS, RETURN_STATUSES, REFUND_METHODS in @markaz/contracts. Keep them identical. */
export const RETURN_REASON_VALUES = ['damaged', 'wrong_item', 'changed_mind', 'other'] as const;
/** completed is a legacy value (the Sprint 4 shell): still readable, never written by the Sprint 5 routes. */
export const RETURN_STATUS_VALUES = ['requested', 'approved', 'rejected', 'received', 'refunded', 'completed'] as const;
export const RETURN_REFUND_METHOD_VALUES = ['bank', 'jazzcash', 'easypaisa', 'cash'] as const;
export const RETURN_NOTE_TEXT_MAX = 300;
export const RETURN_REJECT_TEXT_MAX = 200;
export const RETURN_REFERENCE_TEXT_MAX = 100;

/** One returned line (a line is productId + variantId: there is no lineId). unitPrice is the order's own price, whole rupees. */
export interface IReturnItem {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  unitPrice: number;
}

/** What the seller says came back (set once, when the return is received). restock: it went back on the shelf. */
export interface IReturnReceived {
  productId: string;
  variantId: string;
  quantity: number;
  restock: boolean;
}

/** One recorded refund. No money moves through the system: the seller pays the customer back by their own means (D-107). */
export interface IReturnRefund {
  amount: number;
  method: (typeof RETURN_REFUND_METHOD_VALUES)[number];
  reference?: string | null;
  at: Date;
  by: Types.ObjectId | null;
}

/**
 * Collection: returns (apps/admin/src/collections/Returns.ts). Sprint 5 EP-13 (D-107, D-108) EXTENDS it: a return now names its order
 * and phone credential, the lines and quantities returned, and records the refunds. Several partial returns per order are allowed.
 *
 * Every Sprint 5 field is optional: a return written before it (the Sprint 4 shell) must keep loading.
 */
export interface IReturn extends Document {
  order: Types.ObjectId;
  store: Types.ObjectId;
  customer?: Types.ObjectId | null;
  reason: (typeof RETURN_REASON_VALUES)[number];
  description?: string | null;
  images: Types.ObjectId[];
  status: (typeof RETURN_STATUS_VALUES)[number];
  refundType?: 'store_credit' | 'cod_refund' | 'replacement' | null;
  /** The running total of refunds[] in whole rupees (kept by one compare-and-set per refund). */
  refundAmount?: number | null;
  adminNotes?: string | null;
  /** Unique per store, such as RET-7KQ4M2XA. */
  returnNumber?: string | null;
  orderNumber?: string | null;
  items?: IReturnItem[];
  /** The normalized phone (+923xxxxxxxxx) of the shopper who asked: the credential and the key of the customer's returns count. */
  contactPhone?: string | null;
  reasonCode?: (typeof RETURN_REASON_VALUES)[number] | null;
  /** The seller's reason when a return is rejected. Never copied to the audit log. */
  rejectReason?: string | null;
  received?: IReturnReceived[];
  refunds?: IReturnRefund[];
  /** When the return was rejected or fully refunded. */
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ReturnItemSchema = new Schema<IReturnItem>(
  {
    productId: { type: String, required: true },
    variantId: { type: String, required: true },
    productTitle: { type: String, required: true },
    variantTitle: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'must be a whole number' } },
    unitPrice: { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'must be whole rupees' } },
  },
  { _id: false },
);

const ReturnReceivedSchema = new Schema<IReturnReceived>(
  {
    productId: { type: String, required: true },
    variantId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'must be a whole number' } },
    restock: { type: Boolean, required: true },
  },
  { _id: false },
);

const ReturnRefundSchema = new Schema<IReturnRefund>(
  {
    amount: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'must be whole rupees' } },
    method: { type: String, required: true, enum: [...RETURN_REFUND_METHOD_VALUES] },
    reference: { type: String, trim: true, maxlength: RETURN_REFERENCE_TEXT_MAX, default: null },
    at: { type: Date, required: true, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const ReturnSchema = new Schema<IReturn>(
  {
    order: { type: Schema.Types.ObjectId, required: true, index: true },
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, required: true, enum: [...RETURN_REASON_VALUES] },
    description: { type: String, trim: true, maxlength: RETURN_NOTE_TEXT_MAX, default: null },
    images: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: [...RETURN_STATUS_VALUES], default: 'requested' },
    refundType: { type: String, enum: ['store_credit', 'cod_refund', 'replacement'], default: null },
    refundAmount: { type: Number, min: 0, default: null },
    adminNotes: { type: String, default: null },
    // Sprint 5. No defaults: a return of the Sprint 4 shell has none of these.
    returnNumber: { type: String, trim: true, maxlength: 20 },
    orderNumber: { type: String, trim: true, maxlength: 40 },
    items: { type: [ReturnItemSchema], default: undefined },
    contactPhone: { type: String, trim: true, maxlength: 16 },
    reasonCode: { type: String, enum: [...RETURN_REASON_VALUES] },
    rejectReason: { type: String, trim: true, maxlength: RETURN_REJECT_TEXT_MAX },
    received: { type: [ReturnReceivedSchema], default: undefined },
    refunds: { type: [ReturnRefundSchema], default: undefined },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

// A shopper's return number is unique inside a store. Partial, so the returns that predate it (and have none) never collide.
ReturnSchema.index({ store: 1, returnNumber: 1 }, { unique: true, name: 'store_returnNumber_unique', partialFilterExpression: { returnNumber: { $type: 'string' } } });
// The returns of one order (the quantity caps and the order's own "everything is back" check read this).
ReturnSchema.index({ store: 1, order: 1 });
// The seller's list by status, newest first.
ReturnSchema.index({ store: 1, status: 1, createdAt: -1 });
// One customer's returns count (the customer page and the repeat_returns risk rule): by the normalized phone.
ReturnSchema.index({ store: 1, contactPhone: 1 });

export const Return: Model<IReturn> =
  (mongoose.models.Return as Model<IReturn> | undefined) ?? mongoose.model<IReturn>('Return', ReturnSchema);
