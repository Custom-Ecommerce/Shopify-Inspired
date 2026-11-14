import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** The same values as OUTBOX_STATUSES in @markaz/notifications (this package depends on mongoose only). */
export const NOTIFICATION_OUTBOX_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export const NOTIFICATION_OUTBOX_CHANNELS = ['email'] as const;

/**
 * Collection: notificationoutbox (EP-07, D-091). One row per message, written after the business action is saved and
 * sent by @markaz/notifications (immediately, then by the flush route on failure). The rendered subject and bodies are
 * stored, so a retry sends exactly what was rendered. dedupeKey is unique when present: a repeated event cannot queue the
 * same message twice. Rows are never deleted by the code.
 */
export interface INotificationOutbox {
  _id: Types.ObjectId;
  channel: (typeof NOTIFICATION_OUTBOX_CHANNELS)[number];
  to: string;
  template: string;
  /** The values the message was rendered from. */
  payload: Record<string, unknown>;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  status: (typeof NOTIFICATION_OUTBOX_STATUSES)[number];
  attempts: number;
  /** When the row may be (re)sent; null once it is final (sent, skipped, or failed for good). */
  nextAttemptAt: Date | null;
  lastError: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date | null;
  store?: Types.ObjectId | null;
  order?: Types.ObjectId | null;
  dedupeKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationOutboxSchema = new Schema<INotificationOutbox>(
  {
    channel: { type: String, enum: [...NOTIFICATION_OUTBOX_CHANNELS], required: true, default: 'email' },
    to: { type: String, required: true, trim: true, maxlength: 254 },
    template: { type: String, required: true, maxlength: 80 },
    payload: { type: Schema.Types.Mixed, default: {} },
    subject: { type: String, required: true, maxlength: 200 },
    bodyText: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    status: { type: String, enum: [...NOTIFICATION_OUTBOX_STATUSES], required: true, default: 'queued' },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 300 },
    provider: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    sentAt: { type: Date, default: null },
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    dedupeKey: { type: String, maxlength: 200 },
  },
  { timestamps: true, collection: 'notificationoutbox' },
);

NotificationOutboxSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true, name: 'dedupeKey_unique' });
// The flush reads due rows oldest first.
NotificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
NotificationOutboxSchema.index({ order: 1 }, { sparse: true });

export const NotificationOutbox: Model<INotificationOutbox> =
  (mongoose.models.NotificationOutbox as Model<INotificationOutbox> | undefined) ??
  mongoose.model<INotificationOutbox>('NotificationOutbox', NotificationOutboxSchema);
