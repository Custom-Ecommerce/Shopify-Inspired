import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** Same limits as CUSTOMER_NOTE_MAX, CUSTOMER_TAG_MAX and CUSTOMER_TAGS_MAX_COUNT in @markaz/contracts. Keep them identical. */
export const CUSTOMER_NOTE_TEXT_MAX = 500;
export const CUSTOMER_TAG_TEXT_MAX = 20;
export const CUSTOMER_TAGS_LIMIT = 5;

/**
 * Collection: customernotes (Sprint 5 EP-10.US01, D-107). The only stored thing about a customer: the seller's private note
 * and tags. There is NO customer collection; customers are derived from the store's orders. key is the normalized phone
 * (+923xxxxxxxxx) or, for an order with no phone, the lower-case email. One row per { store, key }.
 *
 * The note is the seller's own text and never leaves the seller portal: no storefront route reads this collection, and no
 * audit entry carries the text.
 */
export interface ICustomerNote {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  key: string;
  note: string;
  tags: string[];
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerNoteSchema = new Schema<ICustomerNote>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    key: { type: String, required: true, trim: true, lowercase: true, minlength: 1, maxlength: 254 },
    note: { type: String, trim: true, maxlength: CUSTOMER_NOTE_TEXT_MAX, default: '' },
    tags: {
      type: [{ type: String, trim: true, minlength: 1, maxlength: CUSTOMER_TAG_TEXT_MAX }],
      default: [],
      validate: { validator: (value: string[]) => value.length <= CUSTOMER_TAGS_LIMIT, message: 'at most ' + CUSTOMER_TAGS_LIMIT + ' tags' },
    },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'customernotes', timestamps: true },
);

// One note row per customer of a store: the unique index is what makes the upsert race-safe.
CustomerNoteSchema.index({ store: 1, key: 1 }, { unique: true, name: 'store_key_unique' });

export const CustomerNote: Model<ICustomerNote> =
  (mongoose.models.CustomerNote as Model<ICustomerNote> | undefined) ?? mongoose.model<ICustomerNote>('CustomerNote', CustomerNoteSchema);
