import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { STOCK_STATUSES } from './stock-status';

/** A relation as the frontend reads it: the ObjectId, or the populated document (depth 1). */
const populatedRef = z.object({
  id: objectIdSchema,
  name: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});
const relation = z.union([objectIdSchema, populatedRef]);

/** Payload stores highlights as rows with a text subfield. */
export const highlightSchema = z.object({ text: z.string().min(1) });

/** One row of the stockHistory audit trail (Products.ts: quantity, previousQuantity, reason, changedAt). */
export const stockHistoryEntrySchema = z.object({
  quantity: z.number().nullable().optional(),
  previousQuantity: z.number().nullable().optional(),
  reason: z.string().nullable().optional(),
  changedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const productSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  title: z.string().min(1),
  slug: z.string().min(1),
  categories: z.array(relation).min(1),
  media: z.array(relation),
  description: z.string().nullable().optional(),
  highlights: z.array(highlightSchema).optional(),
  price: z.number().min(0),
  originalPrice: z.number().min(0).nullable().optional(),
  stockStatus: z.enum(STOCK_STATUSES),
  stockQuantity: z.number().int().min(0),
  stockHistory: z.array(stockHistoryEntrySchema).optional(),
  isFeatured: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).nullable().optional(),
  reservedQuantity: z.number().int().min(0).optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  seoImage: relation.nullable().optional(),
  avgRating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  viewCount: z.number().int().min(0).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Product = z.infer<typeof productSchema>;
export type ProductRelation = z.infer<typeof relation>;
