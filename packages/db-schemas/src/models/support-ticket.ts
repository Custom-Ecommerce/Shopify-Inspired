import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/** Collection: supporttickets (Sprint 7, S7-B4). A seller's request for help from the platform. Messages are plain text, escaped wherever shown. */
export const TICKET_STATUSES = ['open', 'answered', 'closed'] as const;
export const TICKET_AUTHORS = ['seller', 'admin'] as const;

export interface ITicketMessage {
  from: (typeof TICKET_AUTHORS)[number];
  text: string;
  at: Date;
  /** The seller's or the admin's user id. */
  byId: string;
}

export interface ISupportTicket extends Document {
  seller: Types.ObjectId;
  store?: Types.ObjectId | null;
  subject: string;
  messages: ITicketMessage[];
  status: (typeof TICKET_STATUSES)[number];
  /** An order number the seller is asking about, optional. */
  orderRef?: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<ITicketMessage>(
  {
    from: { type: String, enum: TICKET_AUTHORS, required: true },
    text: { type: String, required: true, maxlength: 3000 },
    at: { type: Date, required: true },
    byId: { type: String, required: true, maxlength: 40 },
  },
  { _id: false },
);

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    seller: { type: Schema.Types.ObjectId, required: true },
    store: { type: Schema.Types.ObjectId, default: null },
    subject: { type: String, required: true, trim: true, maxlength: 150 },
    messages: { type: [MessageSchema], default: [] },
    status: { type: String, enum: TICKET_STATUSES, default: 'open' },
    orderRef: { type: String, default: null, trim: true, maxlength: 40 },
    revision: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

// A seller's own tickets, newest first; the admin's inbox by status, newest first; the retention purge by status and age.
SupportTicketSchema.index({ seller: 1, createdAt: -1 });
SupportTicketSchema.index({ status: 1, updatedAt: -1 });

export const SupportTicket: Model<ISupportTicket> =
  (mongoose.models.SupportTicket as Model<ISupportTicket> | undefined) ?? mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
