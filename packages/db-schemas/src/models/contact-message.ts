import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: contactmessages (Sprint 7, S7-B4). A message from the public contact form. scope 'store': a shopper writing to a store (the seller reads it in
 * their inbox). scope 'platform': a visitor writing to Markazify (the admin reads it). Plain text only: it is escaped wherever it is shown.
 */
export const CONTACT_SCOPES = ['platform', 'store'] as const;
export const CONTACT_STATUSES = ['new', 'read', 'replied', 'closed'] as const;
export const CONTACT_REPLY_CHANNELS = ['email', 'whatsapp'] as const;

export interface IContactReply {
  text: string;
  at: Date;
  /** The seller's user id (store scope) or 'admin:<id>' (platform scope). */
  by: string;
  channel: (typeof CONTACT_REPLY_CHANNELS)[number];
}

export interface IContactMessage extends Document {
  scope: (typeof CONTACT_SCOPES)[number];
  /** Required for scope 'store', absent for 'platform'. */
  store?: Types.ObjectId | null;
  name: string;
  email: string;
  phone?: string | null;
  message: string;
  status: (typeof CONTACT_STATUSES)[number];
  /** The sender agreed to be answered at the address and number given. */
  consent: boolean;
  replies: IContactReply[];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const ReplySchema = new Schema<IContactReply>(
  {
    text: { type: String, required: true, maxlength: 3000 },
    at: { type: Date, required: true },
    by: { type: String, required: true, maxlength: 80 },
    channel: { type: String, enum: CONTACT_REPLY_CHANNELS, required: true },
  },
  { _id: false },
);

const ContactMessageSchema = new Schema<IContactMessage>(
  {
    scope: { type: String, enum: CONTACT_SCOPES, required: true },
    store: {
      type: Schema.Types.ObjectId,
      default: null,
      validate: { validator(this: IContactMessage, value: unknown) { return this.scope !== 'store' || value !== null && value !== undefined; }, message: 'a store message needs a store' },
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, default: null, trim: true, maxlength: 30 },
    message: { type: String, required: true, trim: true, maxlength: 3000 },
    status: { type: String, enum: CONTACT_STATUSES, default: 'new' },
    consent: { type: Boolean, default: false },
    replies: { type: [ReplySchema], default: [] },
    revision: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

// The seller's inbox (a store, by status, newest first) and the admin's (a scope, by status, newest first). ensure-indexes creates them.
ContactMessageSchema.index({ store: 1, status: 1, createdAt: -1 });
ContactMessageSchema.index({ scope: 1, status: 1, createdAt: -1 });

export const ContactMessage: Model<IContactMessage> =
  (mongoose.models.ContactMessage as Model<IContactMessage> | undefined) ?? mongoose.model<IContactMessage>('ContactMessage', ContactMessageSchema);
