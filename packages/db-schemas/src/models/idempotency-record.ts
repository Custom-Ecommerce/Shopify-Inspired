import mongoose, { Schema, type Model, type Types } from 'mongoose';

/**
 * Collection: idempotencyrecords (Sprint 9, EP-31.US03.T02). One row per Idempotency-Key a user sent with a phone write: the request it stood for and,
 * once done, the answer, so the same request sent again (a queued change, a lost response) is answered the same way without doing the work twice.
 *
 * state pending: the work is running (or its process died; see the take-over in the backend). state done: responseStatus and responseBody are the answer.
 * MongoDB removes a row at expiresAt (7 days).
 *
 * Indexes (declared here, planned by scripts/ensure-indexes.mjs):
 *   {user, key}   unique: of two requests with one key, one wins the insert
 *   {expiresAt}   TTL
 */
export interface IIdempotencyRecord {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  key: string;
  route: string;
  /** SHA-256 hex of the canonical request (route, store, record id, body). */
  requestHash: string;
  state: 'pending' | 'done';
  responseStatus: number | null;
  responseBody: unknown;
  startedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IdempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true, maxlength: 128 },
    route: { type: String, required: true, maxlength: 80 },
    requestHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    state: { type: String, enum: ['pending', 'done'], required: true, default: 'pending' },
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  // bufferCommands off, as the seller backend connects. minimize off: an empty object in a stored answer stays.
  { timestamps: true, collection: 'idempotencyrecords', bufferCommands: false, minimize: false },
);

IdempotencyRecordSchema.index({ user: 1, key: 1 }, { unique: true, name: 'user_key_unique' });
IdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

export const IdempotencyRecord: Model<IIdempotencyRecord> =
  (mongoose.models.IdempotencyRecord as Model<IIdempotencyRecord> | undefined) ?? mongoose.model<IIdempotencyRecord>('IdempotencyRecord', IdempotencyRecordSchema);
