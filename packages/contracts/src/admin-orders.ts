import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Sprint 6 EP-12 (S6-B5, D-093): the admin console's READ-ONLY view of orders, through the signed internal seller calls. SAFE fields only: an
 * operator never sees a shopper's name, phone, street address or email. Money is WHOLE RUPEES. A test walks every DTO and fails on a forbidden key.
 */

export const ADMIN_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'] as const;
export const ADMIN_ORDER_PAGE_MAX = 50;

/** Keys that must never appear anywhere in an admin order DTO. */
export const ADMIN_ORDER_FORBIDDEN_KEYS = [
  'phone', 'phoneKey', 'address', 'customerName', 'customerEmail', 'email', 'customerNote', 'customerWhatsapp', 'whatsapp', 'notes', 'ip',
] as const;

const isoDate = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-20.');
const rupees = z.number().int().min(0);

const filters = {
  store: objectIdSchema.optional(),
  status: z.enum(ADMIN_ORDER_STATUSES).optional(),
  from: day.optional(),
  to: day.optional(),
  q: z.string().trim().min(1).max(40).optional(),
};

/** The admin console's query (strings from the URL). */
export const adminOrderListQuerySchema = z
  .object({ ...filters, page: z.coerce.number().int().min(1).max(10_000).default(1), limit: z.coerce.number().int().min(1).max(ADMIN_ORDER_PAGE_MAX).default(20) })
  .strict();
export type AdminOrderListQuery = z.output<typeof adminOrderListQuerySchema>;

/** Admin backend -> seller backend, signed. */
export const internalOrderListRequestSchema = z
  .object({ ...filters, page: z.number().int().min(1).max(10_000), limit: z.number().int().min(1).max(ADMIN_ORDER_PAGE_MAX) })
  .strict();
export const internalOrderDetailRequestSchema = z.object({ orderId: objectIdSchema }).strict();

export const adminOrderRowSchema = z
  .object({
    id: objectIdSchema,
    orderNumber: z.string(),
    storeId: objectIdSchema,
    storeName: z.string().nullable(),
    status: z.enum(ADMIN_ORDER_STATUSES),
    paymentMethod: z.enum(['cod', 'card']).nullable(),
    total: rupees,
    city: z.string().nullable(),
    itemCount: z.number().int().min(0),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();
export type AdminOrderRow = z.output<typeof adminOrderRowSchema>;

export const adminOrderListSchema = z.object({
  docs: z.array(adminOrderRowSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalDocs: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type AdminOrderList = z.output<typeof adminOrderListSchema>;

export const adminOrderDetailSchema = adminOrderRowSchema.extend({
  items: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1), unitPrice: rupees, lineTotal: rupees }).strict()),
  totals: z.object({ subtotal: rupees, discount: rupees, delivery: rupees, total: rupees }).strict(),
  statusHistory: z.array(z.object({ from: z.enum(ADMIN_ORDER_STATUSES), to: z.enum(ADMIN_ORDER_STATUSES), at: isoDate }).strict()),
  paymentStatus: z.enum(['unpaid', 'collected', 'paid']),
  confirmationStatus: z.enum(['not_required', 'unconfirmed', 'confirmed', 'unreachable']),
});
export type AdminOrderDetail = z.output<typeof adminOrderDetailSchema>;
export const adminOrderDetailResponseSchema = z.object({ order: adminOrderDetailSchema });
