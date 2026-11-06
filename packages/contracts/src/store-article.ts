import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** Article types and statuses, as apps/admin/src/collections/StoreArticles.ts defines them. */
export const ARTICLE_TYPES = ['blog', 'lookbook', 'size_guide', 'care_instructions'] as const;
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;

const relation = z.union([
  objectIdSchema,
  z.object({ id: objectIdSchema, url: z.string().nullable().optional() }),
]);

/** A store article as the dashboard reads it. The rich-text content is carried opaquely. */
export const storeArticleSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  title: z.string().min(1),
  slug: z.string().min(1),
  excerpt: z.string().max(160).nullable().optional(),
  content: z.unknown().optional(),
  coverImage: relation.nullable().optional(),
  type: z.enum(ARTICLE_TYPES).nullable().optional(),
  status: z.enum(ARTICLE_STATUSES).nullable().optional(),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type StoreArticle = z.infer<typeof storeArticleSchema>;
