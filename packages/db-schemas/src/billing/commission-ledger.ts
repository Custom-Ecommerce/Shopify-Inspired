
import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

export const COMMISSION_LEDGER_STATUSES = ['pending', 'settled', 'refunded'] as const;
export const COMMISSION_PAYMENT_METHODS = ['card', 'cod'] as const;

/**
 * Mirrors the Payload CommissionLedger collection (apps/admin/src/collections/CommissionLedger.ts).
 * Collection: commissionLedger.
 *
 * Units follow Payload, not an assumed standard:
 *   - commissionRate is a percentage (4 means 4 percent), as in PlatformSettings.defaultCommissionRate.
 *   - orderAmount and commissionAmount are the minor units the Connect webhook stores.
 *   - refund reversals are negative rows, so no amount field has a minimum.
 *   - orderId is unique: one ledger row per order.
 */
const commissionLedgerSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store' },
    orderId: { type: String, required: true, },
    sellerOrderDocId: { type: String, required: true, index: true },
    orderAmount: { type: Number },
    commissionRate: { type: Number },
    commissionAmount: { type: Number },
    status: { type: String, enum: [...COMMISSION_LEDGER_STATUSES], default: 'pending' },
    paymentMethod: { type: String, enum: [...COMMISSION_PAYMENT_METHODS] },
    stripePaymentIntentId: { type: String },
    applicationFeeId: { type: String },
    settlementDate: { type: Date },
    settlementRef: { type: String },
  },
  { timestamps: true, collection: 'commissionLedger' },
);
commissionLedgerSchema.add({ refundId: { type: String, default: null } });
commissionLedgerSchema.index({ orderId: 1, status: 1, refundId: 1 }, { unique: true, name: 'orderId_status_refundId_unique' });
// The admin ledger list is newest first, filtered by status; totals group by status; the store search resolves to store ids.
commissionLedgerSchema.index({ createdAt: -1, _id: -1 });
commissionLedgerSchema.index({ status: 1, createdAt: -1 });
commissionLedgerSchema.index({ store: 1 });

export type CommissionLedgerDoc = InferSchemaType<typeof commissionLedgerSchema>;

export const CommissionLedgerModel: Model<CommissionLedgerDoc> =
  (models.CommissionLedger as Model<CommissionLedgerDoc> | undefined) ??
  model<CommissionLedgerDoc>('CommissionLedger', commissionLedgerSchema);
