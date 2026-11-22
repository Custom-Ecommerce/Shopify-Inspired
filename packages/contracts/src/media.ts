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
  /** Sprint 7: the name the seller gave the file in the media library. Renaming never changes the url. Null until one is set. */
  name: z.string().nullable().optional(),
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

/** Sprint 7 (S7-B1): PATCH /api/media/:id. The name is the only thing a rename changes; any other key is refused. */
export const MEDIA_NAME_MAX = 120;
export const mediaRenameRequestSchema = z
  .object({ name: z.string().trim().min(1, 'Enter a name.').max(MEDIA_NAME_MAX, 'The name can be at most 120 characters.') })
  .strict();

/** Where a file is used: one entry per feature registered with the seller backend's media registry (products, store settings, later articles, pages, theme config). */
export const mediaUsageFeatureSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** How many records of this feature use the file; items lists at most the first 20. */
  count: z.number().int().min(0),
  items: z.array(z.object({ id: z.string().min(1), title: z.string() })),
});

/** GET /api/media/:id/usage, and the body of a 409 MEDIA_IN_USE (which adds errors and code). */
export const mediaUsageResponseSchema = z.object({
  mediaId: objectIdSchema,
  inUse: z.boolean(),
  total: z.number().int().min(0),
  features: z.array(mediaUsageFeatureSchema),
});

export type Media = z.infer<typeof mediaSchema>;
export type MediaRenameRequest = z.infer<typeof mediaRenameRequestSchema>;
export type MediaUsageFeature = z.infer<typeof mediaUsageFeatureSchema>;
export type MediaUsageResponse = z.infer<typeof mediaUsageResponseSchema>;
export type MediaUploadFields = z.infer<typeof mediaUploadFieldsSchema>;
