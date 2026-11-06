import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** Limits of a video upload. The route enforces them; the duration comes from Cloudinary's answer. */
export const MEDIA_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_VIDEO_MAX_SECONDS = 60;
export const MEDIA_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const MEDIA_VIDEO_FORMATS = ['mp4', 'webm', 'mov'] as const;

/** An image or video record as the dashboard reads it. */
export const mediaSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  alt: z.string().min(1),
  url: z.string().url(),
  cloudinaryPublicId: z.string().min(1),
  cloudinaryResourceType: z.string().min(1),
  mimeType: z.string().nullable().optional(),
  filesize: z.number().int().min(0).nullable().optional(),
  width: z.number().int().min(0).nullable().optional(),
  height: z.number().int().min(0).nullable().optional(),
  resourceType: z.enum(['image', 'video']).optional(),
  duration: z.number().min(0).nullable().optional(),
  bytes: z.number().int().min(0).nullable().optional(),
  format: z.string().nullable().optional(),
  posterUrl: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

/** The text fields of a multipart upload. The file itself is checked by the route. */
export const mediaUploadFieldsSchema = z.object({
  alt: z.string().trim().min(1).max(200),
});

export type Media = z.infer<typeof mediaSchema>;
export type MediaUploadFields = z.infer<typeof mediaUploadFieldsSchema>;
