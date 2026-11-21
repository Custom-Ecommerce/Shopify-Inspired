import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const BLOCKED_CONTACT_KINDS = ['phone', 'email'] as const;
export type BlockedContactKind = (typeof BLOCKED_CONTACT_KINDS)[number];
/** Same limits as BLOCKLIST_MAX and BLOCK_REASON_MAX in @markaz/contracts. Keep them identical. */
export const BLOCKED_CONTACTS_PER_STORE_MAX = 500;
export const BLOCKED_CONTACT_REASON_MAX = 100;

/**
 * Collection: blockedcontacts (Sprint 5 EP-11.US02, D-107). A phone or an email a store refuses orders from. value is stored
 * normalized: the phone as +923xxxxxxxxx (the Order.phoneKey form) and the email in lower case. One row per { store, kind, value }.
 *
 * Seller only: no storefront route reads the list. The storefront order route asks one yes/no question of it and answers with
 * a neutral message that never says the contact is blocked. At most BLOCKED_CONTACTS_PER_STORE_MAX rows per store (the route
 * counts before it inserts). No audit entry carries a value.
 */
export interface IBlockedContact {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  kind: BlockedContactKind;
  value: string;
  reason: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BlockedContactSchema = new Schema<IBlockedContact>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    kind: { type: String, required: true, enum: [...BLOCKED_CONTACT_KINDS] },
    value: { type: String, required: true, trim: true, lowercase: true, minlength: 1, maxlength: 254 },
    reason: { type: String, trim: true, maxlength: BLOCKED_CONTACT_REASON_MAX, default: '' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'blockedcontacts', timestamps: true },
);

// A contact is listed once per store: the unique index is what makes the add race-safe. Also the index the checkout lookup reads.
BlockedContactSchema.index({ store: 1, kind: 1, value: 1 }, { unique: true, name: 'store_kind_value_unique' });
// The seller's list, newest first.
BlockedContactSchema.index({ store: 1, createdAt: -1 });

export const BlockedContact: Model<IBlockedContact> =
  (mongoose.models.BlockedContact as Model<IBlockedContact> | undefined) ?? mongoose.model<IBlockedContact>('BlockedContact', BlockedContactSchema);
