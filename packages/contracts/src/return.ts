import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** Return reasons, statuses, and refund types, as apps/admin/src/collections/Returns.ts defines them. */
export const RETURN_REASONS = ['damaged', 'wrong_item', 'changed_mind', 'other'] as const;
export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'completed'] as const;
export const REFUND_TYPES = ['store_credit', 'cod_refund', 'replacement'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** Allowed moves between statuses (ID-24). Anything not listed is refused with 409. */
export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['completed'],
  rejected: [],
  completed: [],
};

const isoDate = z.string().datetime({ offset: true });

/** A return as the seller dashboard reads it. */
export const returnSchema = z.object({
  id: objectIdSchema,
  order: objectIdSchema,
  store: objectIdSchema,
  customer: objectIdSchema.nullable().optional(),
  reason: z.enum(RETURN_REASONS),
  description: z.string().nullable().optional(),
  images: z.array(objectIdSchema),
  status: z.enum(RETURN_STATUSES),
  refundType: z.enum(REFUND_TYPES).nullable().optional(),
  refundAmount: z.number().min(0).nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** PATCH /api/returns/:id. Only these three fields may change; at least one is required. */
export const returnStatusUpdateSchema = z
  .object({
    status: z.enum(RETURN_STATUSES).optional(),
    refundType: z.enum(REFUND_TYPES).optional(),
    refundAmount: z.number().min(0).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export type Return = z.infer<typeof returnSchema>;
export type ReturnStatusUpdate = z.infer<typeof returnStatusUpdateSchema>;
