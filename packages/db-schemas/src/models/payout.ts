import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const PAYOUT_STATUSES = ['pending_settle', 'paid', 'voided', 'failed'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const PAYOUT_METHODS_DB = ['bank', 'jazzcash', 'easypaisa'] as const;
export type PayoutMethodDb = (typeof PAYOUT_METHODS_DB)[number];

/** What was on file when the payout was made. The full account number is never copied here: only its last 4 characters. */
export interface IPayoutDetailsSnapshot {
  method: PayoutMethodDb;
  accountTitle: string;
  last4: string;
  bankName: string | null;
}

/**
 * Collection: payouts (Sprint 4 EP-05.US03, D-090), in the SELLER database next to the commission ledger it settles.
 * One row per payment the platform made to a store, in WHOLE RUPEES.
 *
 *   pending_settle  the row exists and its entries are being claimed. It only stays so when a request died halfway; the
 *                   admin list shows it and "finish or release" resolves it. At most one per store at a time (the
 *                   partial unique index below), which is also what makes two admins paying at once a 409.
 *   paid            every entry up to `cutoff` was claimed (settledAt and payoutId set) and the sum matched `amount`.
 *   voided          an admin took the payment back: its entries were released and count in the balance again.
 *   failed          the claim did not match what was shown to the admin; its entries were released.
 */
export interface IPayout {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  amount: number;
  method: PayoutMethodDb;
  reference: string;
  note: string | null;
  status: PayoutStatus;
  /** The settlement snapshot: only entries created at or before this moment belong to this payout. */
  cutoff: Date;
  entryCount: number;
  payoutDetailsSnapshot: IPayoutDetailsSnapshot;
  /** The admin who made the payout. */
  createdBy: string;
  paidAt: Date | null;
  failedReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const wholePositiveRupees = { validator: (value: number) => Number.isInteger(value) && value > 0, message: 'must be whole rupees above zero' };

const PayoutSchema = new Schema<IPayout>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    amount: { type: Number, required: true, validate: wholePositiveRupees },
    method: { type: String, enum: [...PAYOUT_METHODS_DB], required: true },
    reference: { type: String, required: true, trim: true, maxlength: 100 },
    note: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: [...PAYOUT_STATUSES], required: true, default: 'pending_settle' },
    cutoff: { type: Date, required: true },
    entryCount: { type: Number, required: true, min: 0, default: 0 },
    payoutDetailsSnapshot: {
      type: new Schema(
        {
          method: { type: String, enum: [...PAYOUT_METHODS_DB], required: true },
          accountTitle: { type: String, required: true, maxlength: 100 },
          last4: { type: String, required: true, maxlength: 4 },
          bankName: { type: String, default: null, maxlength: 80 },
        },
        { _id: false },
      ),
      required: true,
    },
    createdBy: { type: String, required: true, maxlength: 64 },
    paidAt: { type: Date, default: null },
    failedReason: { type: String, default: null, maxlength: 300 },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: String, default: null, maxlength: 64 },
    voidReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true, collection: 'payouts' },
);

// One payout in flight per store: a second create while one is pending_settle fails with a duplicate key (409).
PayoutSchema.index({ store: 1 }, { unique: true, partialFilterExpression: { status: 'pending_settle' }, name: 'store_one_pending_settle' });
PayoutSchema.index({ store: 1, createdAt: -1 });
PayoutSchema.index({ status: 1, createdAt: -1 });

export const Payout: Model<IPayout> = (mongoose.models.Payout as Model<IPayout> | undefined) ?? mongoose.model<IPayout>('Payout', PayoutSchema);
