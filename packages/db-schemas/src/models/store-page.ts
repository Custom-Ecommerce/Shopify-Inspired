import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: storePages (Sprint 7, S7-B3). A static page of a store (about, contact, shipping, returns, privacy, or one the seller writes), shown on
 * the storefront at /pages/<slug> when published. The body is plain text with a small Markdown subset (@markaz/platform-kit/content-markdown).
 * A slug is unique per store; the reserved words (products, cart, ...) are refused by the contract, not here.
 */
export interface IStorePage extends Document {
  store: Types.ObjectId;
  title: string;
  slug: string;
  /** Text with the Markdown subset, at most 50,000 characters. */
  body: string;
  status: 'draft' | 'published';
  /** The footer links to the page while it is published. */
  showInFooter: boolean;
  /** The footer's order: lower first. */
  sortOrder: number;
  /** The version of the record, for the compare-and-set of an update. */
  revision: number;
  /** The media records the body uses. Written by the server only; the media registry reads it. */
  mediaRefs: Types.ObjectId[];
  /** The template the page was made from, when it was ('about' ...). Display only. */
  template?: string | null;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const StorePageSchema = new Schema<IStorePage>(
  {
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    body: { type: String, default: '', maxlength: 50000 },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    showInFooter: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0, min: 0, max: 9999 },
    revision: { type: Number, min: 0, default: 0 },
    mediaRefs: { type: [Schema.Types.ObjectId], default: [] },
    template: { type: String, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A slug is unique per store. The seller backend connects with bufferCommands off, so ensure-indexes creates this one.
StorePageSchema.index({ store: 1, slug: 1 }, { unique: true });
// Which pages use a media file (the media registry asks this before a file can be deleted).
StorePageSchema.index({ store: 1, mediaRefs: 1 });
// The storefront's list of published pages, in footer order.
StorePageSchema.index({ store: 1, status: 1, sortOrder: 1 });

export const StorePage: Model<IStorePage> =
  (mongoose.models.StorePage as Model<IStorePage> | undefined) ?? mongoose.model<IStorePage>('StorePage', StorePageSchema);
