import mongoose, { Schema, type Model, type Types } from 'mongoose';

/**
 * Collection: emailunsubscribes (Sprint 4 EP-07.US04, D-092). A customer who asked, through the link in a broadcast, not to
 * receive that store's broadcasts. Only broadcasts honour it: order and status emails are not affected. email is lower case.
 * The unique index { store, email } makes a repeated unsubscribe a no-op.
 */
export interface IEmailUnsubscribe {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  email: string;
  at: Date;
}

const EmailUnsubscribeSchema = new Schema<IEmailUnsubscribe>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'emailunsubscribes' },
);

EmailUnsubscribeSchema.index({ store: 1, email: 1 }, { unique: true, name: 'store_email_unique' });

export const EmailUnsubscribe: Model<IEmailUnsubscribe> =
  (mongoose.models.EmailUnsubscribe as Model<IEmailUnsubscribe> | undefined) ??
  mongoose.model<IEmailUnsubscribe>('EmailUnsubscribe', EmailUnsubscribeSchema);
