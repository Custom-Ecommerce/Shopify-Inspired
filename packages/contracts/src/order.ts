import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { STOREFRONT_ORDER_STATUSES } from './storefront';

export const orderLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  productTitle: z.string().min(1),
  variantTitle: z.string().min(1),
  sku: z.string().nullable().optional(),
  unitPrice: z.number().int().min(0),
  quantity: z.number().int().min(1),
});

/** Order as the dashboard reads it. Money fields are in PKR as Payload stores them. */
export const orderSchema = z.object({
  id: objectIdSchema,
  orderGroupId: z.string().min(1),
  store: objectIdSchema,
  orderId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: z.string().min(1),
  paymentMethod: z.string().min(1),
  customerName: z.string().min(1),
  phone: z.string().nullable().optional(),
  secondaryPhone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  courierName: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  courierOrderId: z.string().nullable().optional(),
  courierBookingId: z.string().nullable().optional(),
  labelUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(orderLineSchema).min(1),
  subtotal: z.number().min(0),
  deliveryCharges: z.number().min(0),
  total: z.number().min(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type OrderLine = z.infer<typeof orderLineSchema>;
export type Order = z.infer<typeof orderSchema>;

// EP-02 OB-1b: the seller dashboard's order list and detail (D-068). The old orderSchema above is kept: the store
// overview page still types its /api/orders?where= reads with it.

/** Every stored order status. The same seven values as the storefront and the Order model ('returned' is EP-13, D-065). */
export const DASHBOARD_ORDER_STATUSES = STOREFRONT_ORDER_STATUSES;
export type DashboardOrderStatus = (typeof DASHBOARD_ORDER_STATUSES)[number];

/** COD only in EP-02 (US07). An order written before EP-02 has no payment status and reads as unpaid. */
export const DASHBOARD_ORDER_PAYMENT_STATUSES = ['unpaid', 'collected'] as const;
export type DashboardOrderPaymentStatus = (typeof DASHBOARD_ORDER_PAYMENT_STATUSES)[number];

export const DASHBOARD_ORDER_PAYMENT_METHODS = ['cod', 'card'] as const;
export type DashboardOrderPaymentMethod = (typeof DASHBOARD_ORDER_PAYMENT_METHODS)[number];

/** Human labels for the dashboard. */
export const ORDER_STATUS_LABELS: Readonly<Record<DashboardOrderStatus, string>> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

export const ORDER_PAYMENT_STATUS_LABELS: Readonly<Record<DashboardOrderPaymentStatus, string>> = {
  unpaid: 'Unpaid',
  collected: 'COD collected',
};

export const ORDER_PAYMENT_METHOD_LABELS: Readonly<Record<DashboardOrderPaymentMethod, string>> = {
  cod: 'Cash on delivery',
  card: 'Card',
};

export const ORDER_LIST_DEFAULT_LIMIT = 20;
export const ORDER_LIST_MAX_LIMIT = 100;
export const ORDER_LIST_MAX_PAGE = 100000;
/** Search text is trimmed and cut to this many characters before it becomes a regex (D-070). */
export const ORDER_SEARCH_MAX_LENGTH = 40;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day, YYYY-MM-DD. 2026-02-30 is refused. */
export const orderListDaySchema = z
  .string()
  .regex(DAY_PATTERN, { message: 'Use the format YYYY-MM-DD.', abort: true })
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'This is not a real date.');

/**
 * GET /api/orders query. from and to are inclusive days in Pakistan time (UTC+05:00). q is trimmed and cut, not refused,
 * when it is longer than ORDER_SEARCH_MAX_LENGTH (D-070). limit above the maximum is capped; a non-integer or a value
 * below 1 is refused. Not strict: the legacy where, sort and depth parameters may come along.
 */
export const dashboardOrderListQuerySchema = z
  .object({
    status: z.enum(DASHBOARD_ORDER_STATUSES).optional(),
    from: orderListDaySchema.optional(),
    to: orderListDaySchema.optional(),
    q: z
      .string()
      .transform((value) => value.trim().slice(0, ORDER_SEARCH_MAX_LENGTH).trim())
      .optional(),
    page: z.coerce.number().int().min(1).max(ORDER_LIST_MAX_PAGE).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .transform((value) => Math.min(value, ORDER_LIST_MAX_LIMIT))
      .default(ORDER_LIST_DEFAULT_LIMIT),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'from must be on or before to.',
    path: ['to'],
  });

/** One row of the seller's order list. */
export const dashboardOrderListItemSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(DASHBOARD_ORDER_STATUSES),
  /** Null only for an order written before checkout recorded a method. */
  paymentMethod: z.enum(DASHBOARD_ORDER_PAYMENT_METHODS).nullable(),
  paymentStatus: z.enum(DASHBOARD_ORDER_PAYMENT_STATUSES),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  total: z.number().min(0),
  itemCount: z.number().int().min(0),
  courier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  createdAt: z.string().min(1),
});

/** Orders per status for the tabs: same store, dates and search as the list, without its status filter. */
export const dashboardOrderCountsSchema = z.object({
  all: z.number().int().min(0),
  pending: z.number().int().min(0),
  confirmed: z.number().int().min(0),
  processing: z.number().int().min(0),
  dispatched: z.number().int().min(0),
  delivered: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  returned: z.number().int().min(0),
});

/** The list envelope every dashboard list uses, plus the counts. */
export const dashboardOrderListResponseSchema = z.object({
  docs: z.array(dashboardOrderListItemSchema),
  totalDocs: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
  counts: dashboardOrderCountsSchema,
});

export const dashboardOrderItemSchema = z.object({
  productTitle: z.string(),
  variantTitle: z.string(),
  sku: z.string().nullable(),
  unitPrice: z.number().min(0),
  quantity: z.number().int().min(1),
  lineTotal: z.number().min(0),
});

export const dashboardOrderStatusChangeSchema = z.object({
  from: z.enum(DASHBOARD_ORDER_STATUSES),
  to: z.enum(DASHBOARD_ORDER_STATUSES),
  /** The user id of whoever made the change. */
  by: z.string().nullable(),
  at: z.string().min(1),
  note: z.string().nullable(),
});

export const dashboardOrderNoteSchema = z.object({
  id: z.string().nullable(),
  text: z.string(),
  by: z.string().nullable(),
  at: z.string().min(1),
});

/** One order as the seller's detail page reads it. statusHistory and notes are newest first. */
export const dashboardOrderDetailSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(DASHBOARD_ORDER_STATUSES),
  paymentMethod: z.enum(DASHBOARD_ORDER_PAYMENT_METHODS).nullable(),
  paymentStatus: z.enum(DASHBOARD_ORDER_PAYMENT_STATUSES),
  collectedAt: z.string().nullable(),
  collectedAmount: z.number().min(0).nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  items: z.array(dashboardOrderItemSchema),
  subtotal: z.number().min(0),
  deliveryCharges: z.number().min(0),
  total: z.number().min(0),
  courier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  statusHistory: z.array(dashboardOrderStatusChangeSchema),
  notes: z.array(dashboardOrderNoteSchema),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type DashboardOrderListQueryInput = z.input<typeof dashboardOrderListQuerySchema>;
export type DashboardOrderListQuery = z.output<typeof dashboardOrderListQuerySchema>;
export type DashboardOrderListItem = z.output<typeof dashboardOrderListItemSchema>;
export type DashboardOrderCounts = z.output<typeof dashboardOrderCountsSchema>;
export type DashboardOrderListResponse = z.output<typeof dashboardOrderListResponseSchema>;
export type DashboardOrderItem = z.output<typeof dashboardOrderItemSchema>;
export type DashboardOrderStatusChange = z.output<typeof dashboardOrderStatusChangeSchema>;
export type DashboardOrderNote = z.output<typeof dashboardOrderNoteSchema>;
export type DashboardOrderDetail = z.output<typeof dashboardOrderDetailSchema>;
