import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** The product as the reviews page reads it: the ObjectId, or the populated product (depth 1). */
const populatedProduct = z.object({
  id: objectIdSchema,
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
});

/** The Reviews collection (apps/admin/src/collections/Reviews.ts). The status option set is added later. */
export const reviewSchema = z.object({
  id: objectIdSchema,
  product: z.union([objectIdSchema, populatedProduct]),
  store: objectIdSchema,
  customer: objectIdSchema.nullable().optional(),
  order: objectIdSchema.nullable().optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable().optional(),
  body: z.string().min(1),
  status: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Review = z.infer<typeof reviewSchema>;

/**
 * A review kept after its product was permanently deleted (D-014, A-004). Strict on purpose: a customer, an order, a
 * phone or an address cannot be added to this shape by accident.
 */
export const archivedReviewSchema = z
  .object({
    id: objectIdSchema,
    rating: z.number().int().min(1).max(5),
    title: z.string().nullable(),
    body: z.string().min(1),
    reviewedAt: z.string().datetime({ offset: true }),
    product: z.object({ title: z.string().min(1), slug: z.string().min(1), store: objectIdSchema }).strict(),
    archivedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ArchivedReview = z.infer<typeof archivedReviewSchema>;

/** PATCH /api/reviews/:id. A seller may set the moderation status only (see ID-21). */
export const reviewStatusUpdateSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected']),
  })
  .strict();

export type ReviewStatusUpdate = z.infer<typeof reviewStatusUpdateSchema>;
