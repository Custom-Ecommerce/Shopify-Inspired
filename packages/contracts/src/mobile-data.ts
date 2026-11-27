import { z } from 'zod';
import { sellerAlertSchema } from './notifications';
import { objectIdSchema } from './object-id';
import { dashboardOrderCountsSchema, dashboardOrderDetailSchema, dashboardOrderListItemSchema } from './order';
import { INVENTORY_QUANTITY_MAX, INVENTORY_REASON_MAX } from './product';
import { rupeesInputSchema } from './money';

/*
 * Sprint 9 (EP-31.US03): the data of /api/mobile/v1 (seller app). FROZEN with the sign-in shapes in mobile.ts: a new optional field is fine, anything else
 * needs /v2. Enumerations that may grow are plain strings, so an installed app keeps reading.
 *
 * REVISION. Every record an app reads carries `revision` and `updatedAt`. The revision is the record's last change as milliseconds since 1970 (0 for a
 * record that never had one). A write sends the revision the app saw; when the record has moved on the answer is 409 CONFLICT with the current record. A
 * variant has its product's revision: stock and price live in the product document.
 */

export const MOBILE_PAGE_DEFAULT = 20;
export const MOBILE_PAGE_MAX = 50;

export const mobileStampSchema = z.object({ revision: z.number().int().min(0), updatedAt: z.string().datetime() });
export type MobileStamp = z.output<typeof mobileStampSchema>;

const pageSchema = <T extends z.ZodType>(row: T) =>
  z.object({ docs: z.array(row), page: z.number().int().min(1), limit: z.number().int().min(1).max(MOBILE_PAGE_MAX), totalDocs: z.number().int().min(0), totalPages: z.number().int().min(0) });

// ---------------------------------------------------------------------------------------------------------------------
// Reads

export const mobileStoreSchema = mobileStampSchema.extend({
  id: objectIdSchema,
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  role: z.string(),
  logoUrl: z.string().nullable(),
});
export const mobileStoreListSchema = z.object({ stores: z.array(mobileStoreSchema) });

export const mobileOrderListItemSchema = dashboardOrderListItemSchema.extend(mobileStampSchema.shape);
export const mobileOrderListSchema = pageSchema(mobileOrderListItemSchema).extend({ counts: dashboardOrderCountsSchema, unconfirmedCount: z.number().int().min(0) });
export const mobileOrderDetailSchema = dashboardOrderDetailSchema.extend(mobileStampSchema.shape);

export const mobileDashboardSchema = mobileStampSchema.extend({
  storeId: objectIdSchema,
  ordersToday: z.number().int().min(0),
  pendingOrders: z.number().int().min(0),
  unconfirmedOrders: z.number().int().min(0),
  /** null when the role cannot read products. */
  lowStockProducts: z.number().int().min(0).nullable(),
  /** Delivered orders of this month, whole rupees; null when the role does not see money (only the owner does). */
  revenueThisMonth: z.number().int().min(0).nullable(),
  recentOrders: z.array(mobileOrderListItemSchema),
  /**
   * Added in S9-B6 (optional, so the contract stays v1). The analytics page's money: every order except cancelled and returned, UTC days, whole rupees;
   * the week is today and the six days before. null when the role has no analytics (staff, support).
   */
  salesToday: z.number().int().min(0).nullable().optional(),
  salesThisWeek: z.number().int().min(0).nullable().optional(),
});

export const mobileVariantSchema = mobileStampSchema.extend({
  id: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  price: z.number(),
  compareAtPrice: z.number().nullable(),
  trackQuantity: z.boolean(),
  stockQuantity: z.number(),
  availability: z.string(),
});

export const mobileProductListItemSchema = mobileStampSchema.extend({
  id: objectIdSchema,
  title: z.string(),
  status: z.string(),
  minPrice: z.number(),
  totalStock: z.number(),
  stockStatus: z.string(),
  variantCount: z.number().int().min(0),
  imageUrl: z.string().nullable(),
});
export const mobileProductListSchema = pageSchema(mobileProductListItemSchema);
export const mobileProductDetailSchema = mobileProductListItemSchema.extend({
  description: z.string().nullable(),
  variants: z.array(mobileVariantSchema),
  media: z.array(z.object({ id: z.string(), url: z.string(), alt: z.string().nullable() })),
});

export const mobileCustomerSchema = mobileStampSchema.extend({
  /** The key the customer is grouped by: the phone, or the email. */
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  orderCount: z.number().int().min(0),
  deliveredCount: z.number().int().min(0),
  totalSpent: z.number(),
  lastOrderAt: z.string().nullable(),
  tags: z.array(z.string()),
});
export const mobileCustomerListSchema = pageSchema(mobileCustomerSchema);

/** GET /customers/:key (S9-B7): what the website's customer page shows, read-only. */
export const mobileCustomerDetailSchema = mobileStampSchema.extend({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  unsubscribed: z.boolean(),
  stats: z.object({
    orderCount: z.number().int().min(0),
    deliveredCount: z.number().int().min(0),
    cancelledCount: z.number().int().min(0),
    totalSpent: z.number(),
    averageOrderValue: z.number(),
    firstOrderAt: z.string().nullable(),
    lastOrderAt: z.string().nullable(),
    returnsCount: z.number().int().min(0),
  }),
  note: z.string(),
  tags: z.array(z.string()),
  noteUpdatedAt: z.string().nullable(),
  orders: z.array(
    z.object({
      id: z.string(),
      orderId: z.string(),
      createdAt: z.string(),
      status: z.string(),
      total: z.number(),
      paymentMethod: z.string().nullable(),
      paymentStatus: z.string(),
    }),
  ),
  addresses: z.array(z.object({ address: z.string(), city: z.string().nullable() })),
});

export const mobileAlertSchema = sellerAlertSchema.extend(mobileStampSchema.shape);
export const mobileAlertListSchema = pageSchema(mobileAlertSchema).extend({ unread: z.number().int().min(0) });

/** GET /orders?payment= (S9-B6): cod = cash on delivery orders (no recorded method counts as one); paid = the money has been received. */
export const MOBILE_ORDER_PAYMENT_FILTERS = ['cod', 'paid'] as const;
export type MobileOrderPaymentFilter = (typeof MOBILE_ORDER_PAYMENT_FILTERS)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Writes. Each needs the Idempotency-Key header and the revision the app saw.

export const MOBILE_IDEMPOTENCY_HEADER = 'idempotency-key';
export const MOBILE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const MOBILE_IDEMPOTENCY_TTL_DAYS = 7;

export const MOBILE_WRITE_CODES = {
  /** 409 { current }: the record moved on since the revision that was sent. */
  CONFLICT: 'CONFLICT',
  KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  /** 422: this key was already used for a different request. */
  KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  /** 409: the same request is still running; send it again shortly. */
  IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
} as const;

export const mobileRevisionSchema = z.number({ error: 'revision is required' }).int().min(0);

/** POST /orders/:id/status: the portal's transition body plus the revision. */
export const mobileOrderStatusRevisionSchema = z.object({ revision: mobileRevisionSchema });
export const mobileOrderNoteRevisionSchema = z.object({ revision: mobileRevisionSchema });

/** POST /products/:id/stock: the count the seller just took (never a change). */
export const mobileStockRequestSchema = z
  .object({
    revision: mobileRevisionSchema,
    variantId: objectIdSchema,
    quantity: z.number().int().min(0).max(INVENTORY_QUANTITY_MAX),
    reason: z.string().trim().min(1).max(INVENTORY_REASON_MAX).optional(),
  })
  .strict();

/** POST /products/:id/price. compareAtPrice left out keeps the stored one; null removes it. */
export const mobilePriceRequestSchema = z
  .object({ revision: mobileRevisionSchema, variantId: objectIdSchema, price: rupeesInputSchema, compareAtPrice: rupeesInputSchema.nullable().optional() })
  .strict();

export const mobileConflictSchema = z.object({ errors: z.array(z.object({ message: z.string() })), code: z.literal('CONFLICT'), current: mobileStampSchema.passthrough() });

export type MobileStore = z.output<typeof mobileStoreSchema>;
export type MobileDashboard = z.output<typeof mobileDashboardSchema>;
export type MobileOrderListItem = z.output<typeof mobileOrderListItemSchema>;
export type MobileOrderDetail = z.output<typeof mobileOrderDetailSchema>;
export type MobileOrderList = z.output<typeof mobileOrderListSchema>;
export type MobileProductListItem = z.output<typeof mobileProductListItemSchema>;
export type MobileProductList = z.output<typeof mobileProductListSchema>;
export type MobileProductDetail = z.output<typeof mobileProductDetailSchema>;
export type MobileVariant = z.output<typeof mobileVariantSchema>;
export type MobileCustomer = z.output<typeof mobileCustomerSchema>;
export type MobileCustomerList = z.output<typeof mobileCustomerListSchema>;
export type MobileCustomerDetail = z.output<typeof mobileCustomerDetailSchema>;
export type MobileAlert = z.output<typeof mobileAlertSchema>;
export type MobileAlertList = z.output<typeof mobileAlertListSchema>;
export type MobileStockRequest = z.input<typeof mobileStockRequestSchema>;
export type MobilePriceRequest = z.input<typeof mobilePriceRequestSchema>;
