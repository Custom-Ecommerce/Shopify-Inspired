
import mongoose, { Schema, type Document, type Model } from 'mongoose';

export const SYNC_TARGETS = ['admin', 'seller'] as const;
export const SYNC_STATUSES = ['pending', 'sent', 'dead'] as const;

/**
* Mirrors the Payload sync-outbox collection (apps/admin/src/collections/sync-outbox.ts).
* Collection: sync-outbox. The field set below is the one the sync engine reads and
* writes. The earlier event/error shape in this package was a different schema and
* is removed. The required flag on target is to be confirmed in B1.
*/
export interface ISyncOutbox extends Document {
eventId: string;
target: (typeof SYNC_TARGETS)[number];
entity: string;
entityId: string;
group: string;
revision: number;
payload: unknown;
status: (typeof SYNC_STATUSES)[number];
attempts: number;
nextAttemptAt?: Date | null;
lastError?: string | null;
sentAt?: Date | null;
createdAt: Date;
updatedAt: Date;
}

const SyncOutboxSchema = new Schema(
{
eventId: { type: String, required: true, unique: true, index: true },
target: { type: String, enum: [...SYNC_TARGETS], required: true },
entity: { type: String, required: true },
entityId: { type: String, required: true },
group: { type: String, required: true },
revision: { type: Number, required: true },
payload: { type: Schema.Types.Mixed, required: true },
status: { type: String, enum: [...SYNC_STATUSES], required: true, default: 'pending' },
attempts: { type: Number, default: 0 },
nextAttemptAt: { type: Date },
lastError: { type: String },
sentAt: { type: Date },
},
{ timestamps: true, collection: 'sync-outbox' },
);

// One revision per (entity, entityId, group). Concurrent writers that compute the
// same next revision collide here; enqueueSyncEvent retries the loser.
SyncOutboxSchema.index({ entity: 1, entityId: 1, group: 1, revision: 1 }, { unique: true });

// Admin sync health: counts per status, the oldest pending and last sent lookups, and the event list by status.
SyncOutboxSchema.index({ status: 1, createdAt: -1 });
SyncOutboxSchema.index({ status: 1, sentAt: -1 });
// The seller dispatcher loads due pending rows for the seller target, oldest attempt first.
SyncOutboxSchema.index({ target: 1, status: 1, nextAttemptAt: 1 });

export const SyncOutbox: Model<ISyncOutbox> =
(mongoose.models.SyncOutbox as Model<ISyncOutbox> | undefined) ??
mongoose.model<ISyncOutbox>('SyncOutbox', SyncOutboxSchema, 'sync-outbox');
