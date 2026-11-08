import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { containsHtmlTag } from './product';

/*
 * Admin product moderation (D-002, D-026). The seller backend serves these under /api/internal/moderation, the admin
 * backend calls them, and the admin console validates against the same shapes.
 */

export const MODERATION_REASON_MIN = 3;
export const MODERATION_REASON_MAX = 500;
export const MODERATION_LIST_MAX_LIMIT = 50;
export const MODERATION_LIST_DEFAULT_LIMIT = 20;
export const MODERATION_SEARCH_MAX_LENGTH = 80;

export const MODERATION_STATUSES = ['live', 'draft', 'takedown', 'trash'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

/** Plain text, as a seller's description is (D-038): an HTML tag is refused, never stripped. */
export const moderationReasonSchema = z
  .string()
  .trim()
  .min(MODERATION_REASON_MIN, 'Give a reason of at least ' + MODERATION_REASON_MIN + ' characters.')
  .max(MODERATION_REASON_MAX)
  .refine((value) => !containsHtmlTag(value), 'Use plain text: HTML tags are not allowed.');

export const moderationTakedownRequestSchema = z.object({ productId: objectIdSchema, reason: moderationReasonSchema }).strict();
export const moderationRestoreRequestSchema = z.object({ productId: objectIdSchema }).strict();
export const moderationDeleteRequestSchema = z.object({ productId: objectIdSchema, reason: moderationReasonSchema }).strict();
export const moderationPermanentDeleteRequestSchema = z.object({ productId: objectIdSchema, reason: moderationReasonSchema }).strict();

export const moderationProductListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(MODERATION_LIST_MAX_LIMIT).default(MODERATION_LIST_DEFAULT_LIMIT),
    storeId: objectIdSchema.optional(),
    status: z.enum(MODERATION_STATUSES).optional(),
    q: z.string().trim().max(MODERATION_SEARCH_MAX_LENGTH).optional(),
  })
  .strict();

/** One product as an operator sees it. No seller name, email or phone: the store is named, its owner is not. */
export const moderationProductSchema = z.object({
  storeId: z.string().min(1),
  storeName: z.string().nullable(),
  productId: z.string().min(1),
  title: z.string(),
  slug: z.string(),
  status: z.enum(MODERATION_STATUSES),
  takedownReason: z.string().nullable(),
  takenDownAt: z.string().nullable(),
  /** True when an admin deleted it, so the seller cannot bring it back (D-040). */
  adminDeleted: z.boolean(),
  deleteReason: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const moderationProductListSchema = z.object({
  docs: z.array(moderationProductSchema),
  page: z.number().int(),
  limit: z.number().int(),
  totalDocs: z.number().int(),
  totalPages: z.number().int(),
});

export const moderationPermanentDeleteResponseSchema = z.object({ deleted: z.literal(true), productId: z.string().min(1) });

export type ModerationTakedownRequest = z.output<typeof moderationTakedownRequestSchema>;
export type ModerationRestoreRequest = z.output<typeof moderationRestoreRequestSchema>;
export type ModerationDeleteRequest = z.output<typeof moderationDeleteRequestSchema>;
export type ModerationPermanentDeleteRequest = z.output<typeof moderationPermanentDeleteRequestSchema>;
export type ModerationProductListQuery = z.output<typeof moderationProductListQuerySchema>;
export type ModerationProduct = z.output<typeof moderationProductSchema>;
export type ModerationProductList = z.output<typeof moderationProductListSchema>;
export type ModerationPermanentDeleteResponse = z.output<typeof moderationPermanentDeleteResponseSchema>;
