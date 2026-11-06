import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** The Categories collection (apps/admin/src/collections/Categories.ts). */
export const categorySchema = z.object({
  id: objectIdSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  order: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  banner: z.union([objectIdSchema, z.object({ id: objectIdSchema, url: z.string().nullable().optional() })]).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Category = z.infer<typeof categorySchema>;
