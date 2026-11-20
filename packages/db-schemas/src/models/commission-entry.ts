import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const COMMISSION_ENTRY_TYPES = ['cod_commission', 'card_sale', 'card_commission', 'reversal'] as const;
export type CommissionEntryType = (typeof COMMISSION_ENTRY_TYPES)[number];
/** The types a reversal can reverse (a reversal is never reversed). */
export const REVERSIBLE_ENTRY_TYPES = ['cod_commission', 'card_sale', 'card_commission'] as const;
export type ReversibleEntryType = (typeof REVERSIBLE_ENTRY_TYPES)[number];

/**
 * Collection: commissionentries (Sprint 4 EP-05, D-088, D-089, D-090). The seller-side ledger of what the platform and the
 * seller owe each other, one signed row per money event of a storefront order. NOT the old commissionLedger (Payload
 * shaped, minor units, old checkout): that one stays untouched and read-only.
 *
 * Units: WHOLE RUPEES (the order's own total), never Stripe minor units.
 * balanceEffect is the seller's balance with the platform: card_sale = +amount paid (the platform holds it), card_commission
 * and cod_commission = -commission (the seller owes it), reversal = the opposite sign of the entry it reverses.
 *
 * Append only. A row is never deleted and only settledAt / payoutId (the settlement compare-and-set of SB-7) ever change.
 * The unique index { order, type, reversesType, returnId } makes a repeat of any write a no-op: reversesType is null for every type
 * but a reversal, returnId is null for every entry but the reversal of one RETURN (Sprint 5 EP-13, audit R1), and a unique index treats
 * null (and a missing field) as a value. So an order still has one entry per type and one cancel reversal, plus one reversal per return.
 */
export interface ICommissionEntry {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  order: Types.ObjectId;
  type: CommissionEntryType;
  balanceEffect: number;
  /** The item subtotal after discount the commission was taken on (delivery excluded). For card_sale: the amount paid. */
  baseAmount: number;
  /** Percent, one decimal, as it was when the entry was written. */
  rate: number;
  reversesType: ReversibleEntryType | null;
  /** Sprint 5 EP-13: the return a proportional reversal belongs to. Absent on every other entry (existing entries stay valid). */
  returnId?: Types.ObjectId | null;
  settledAt: Date | null;
  payoutId: Types.ObjectId | null;
  createdAt: Date;
}

const wholeRupees = { validator: Number.isInteger, message: 'must be whole rupees' };

const CommissionEntrySchema = new Schema<ICommissionEntry>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    type: { type: String, enum: [...COMMISSION_ENTRY_TYPES], required: true },
    balanceEffect: { type: Number, required: true, validate: wholeRupees },
    baseAmount: { type: Number, required: true, min: 0, validate: wholeRupees },
    rate: { type: Number, required: true, min: 0, max: 100 },
    reversesType: { type: String, enum: [...REVERSIBLE_ENTRY_TYPES], default: null },
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', default: null },
    settledAt: { type: Date, default: null },
    payoutId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'commissionentries' },
);

// One entry per order, type, reversed type and return: a repeated or parallel write cannot add a second one. The key used to be
// { order, type, reversesType }; scripts/migrate-commission-index.mjs moves a live collection to this one (mongoose never alters an index).
CommissionEntrySchema.index({ order: 1, type: 1, reversesType: 1, returnId: 1 }, { unique: true, name: 'order_type_reverses_return_unique' });
// SB-7: the unsettled balance of a store.
CommissionEntrySchema.index({ store: 1, settledAt: 1 });

const SETTLEMENT_FIELDS = new Set(['settledAt', 'payoutId']);

function refuse(what: string): never {
  throw new Error('commission entries are append only: ' + what + ' is not allowed');
}

/** An update may only set the settlement fields; anything else throws. Exported for the tests. */
export function assertSettlementOnlyUpdate(update: unknown): void {
  const doc = (update ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(doc)) {
    if (key === '$set' || key === '$unset') {
      for (const field of Object.keys((doc[key] ?? {}) as object)) if (!SETTLEMENT_FIELDS.has(field)) refuse('changing ' + field);
    } else if (key === '$setOnInsert') {
      // Mongoose adds { createdAt } to EVERY update of a schema with timestamps (it only matters on an upsert, which nothing here
      // does). Refusing it refused the settlement update itself (found by the Sprint 4 verification); any other field is still refused.
      for (const field of Object.keys((doc[key] ?? {}) as object)) if (field !== 'createdAt') refuse('changing ' + field);
    } else if (key.startsWith('$')) {
      refuse(key);
    } else if (!SETTLEMENT_FIELDS.has(key)) {
      refuse('changing ' + key);
    }
  }
}

// Mongoose types each hook by its own query kind; one loose view of the schema keeps these guards in one place.
const guards = CommissionEntrySchema as unknown as { pre(op: string, fn: (this: any) => void): void };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  guards.pre(op, function () {
    assertSettlementOnlyUpdate(this.getUpdate());
  });
}
for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne']) {
  guards.pre(op, function () {
    refuse(op);
  });
}
guards.pre('save', function () {
  if (this.isNew) return;
  for (const path of this.modifiedPaths() as string[]) if (!SETTLEMENT_FIELDS.has(path)) refuse('changing ' + path);
});

export const CommissionEntry: Model<ICommissionEntry> =
  (mongoose.models.CommissionEntry as Model<ICommissionEntry> | undefined) ??
  mongoose.model<ICommissionEntry>('CommissionEntry', CommissionEntrySchema);
