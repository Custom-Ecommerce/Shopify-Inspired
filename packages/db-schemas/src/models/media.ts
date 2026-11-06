import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

/**
 * Collection: media (apps/admin/src/collections/Media.ts). Records are store-scoped. The file lives in
 * Cloudinary; the record holds its address and public id.
 */
export interface IMedia extends Document {
  store: Types.ObjectId;
  alt: string;
  url: string;
  cloudinaryPublicId: string;
  cloudinaryResourceType: string;
  mimeType?: string | null;
  filesize?: number | null;
  width?: number | null;
  height?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const MediaSchema = new Schema<IMedia>(
  {
    store: { type: Schema.Types.ObjectId, required: true, index: true },
    alt: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    cloudinaryPublicId: { type: String, required: true },
    cloudinaryResourceType: { type: String, required: true, default: 'image' },
    mimeType: { type: String, default: null },
    filesize: { type: Number, min: 0, default: null },
    width: { type: Number, min: 0, default: null },
    height: { type: Number, min: 0, default: null },
  },
  { timestamps: true },
);

export const Media: Model<IMedia> =
  (mongoose.models.Media as Model<IMedia> | undefined) ?? mongoose.model<IMedia>('Media', MediaSchema);
