import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * Sprint 6 EP-16 (S6-B7, D-106): production uses ONE shared database, so the admin sync receiver no longer applies data. It only RECORDS the highest
 * revision the sender acknowledged per (store, group); the digest compares the sender's head revision with it and the repair requeues the gap.
 * One row per (store, group): the unique index is declared here so scripts/ensure-indexes.mjs creates it (the backends build no index at runtime).
 */
export interface IStoreSyncRevision extends Document {
  store: string;
  group: string;
  revision: number;
  receivedAt: Date;
}

const StoreSyncRevisionSchema = new Schema<IStoreSyncRevision>(
  {
    store: { type: String, required: true, maxlength: 64 },
    group: { type: String, required: true, maxlength: 64 },
    revision: { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'revision must be a whole number' } },
    receivedAt: { type: Date, required: true },
  },
  { collection: 'storeSyncRevisions' },
);

StoreSyncRevisionSchema.index({ store: 1, group: 1 }, { unique: true, name: 'store_group_unique' });

export const StoreSyncRevision: Model<IStoreSyncRevision> =
  (mongoose.models.StoreSyncRevision as Model<IStoreSyncRevision> | undefined) ?? mongoose.model<IStoreSyncRevision>('StoreSyncRevision', StoreSyncRevisionSchema);
