import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const BROADCAST_STATUSES = ['queued'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

/**
 * Collection: broadcasts (Sprint 4 EP-07.US04, D-092). One email broadcast of a store to its customers. The recipients are
 * rows of the notification outbox keyed broadcast:<id>:<email>; the counts a seller sees are read from those rows.
 *
 * dayKey is the Asia/Karachi calendar day ("YYYY-MM-DD") the broadcast was made on. The unique index { store, dayKey } is
 * what allows ONE broadcast per store per day: two creates at once leave exactly one, the other gets a duplicate key error.
 */
export interface IBroadcast {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  subject: string;
  message: string;
  recipientCount: number;
  createdBy: Types.ObjectId;
  dayKey: string;
  status: BroadcastStatus;
  createdAt: Date;
  updatedAt: Date;
}

const BroadcastSchema = new Schema<IBroadcast>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    subject: { type: String, required: true, maxlength: 120 },
    message: { type: String, required: true, maxlength: 2000 },
    recipientCount: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dayKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: [...BROADCAST_STATUSES], required: true, default: 'queued' },
  },
  { timestamps: true, collection: 'broadcasts' },
);

BroadcastSchema.index({ store: 1, dayKey: 1 }, { unique: true, name: 'store_dayKey_unique' });
BroadcastSchema.index({ store: 1, createdAt: -1 });

export const Broadcast: Model<IBroadcast> =
  (mongoose.models.Broadcast as Model<IBroadcast> | undefined) ?? mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);
