import { z } from 'zod';

/**
 * Sprint 6 (S6-B5): amounts are WHOLE RUPEES (D-095) and the sales KPIs come from the NEW commission ledger; the old ledger totals are gone.
 * Wire shape of the admin console's overview endpoint (apps/admin-portal): GET /api/admin/overview. The platform's
 * headline numbers in one answer: stores by status, seller accounts, the commission ledger totals, and the health of
 * the sync outbox. Amounts are minor currency units and rates are percentages (ID-18). Every number is a count or a
 * sum over the whole collection, taken when the request was served (generatedAt). No identifier, name, or payload is
 * returned, so the answer carries no personal or store data.
 */

/** The seller list's "new" window, in days. The backend counts the same window. */
export const ADMIN_OVERVIEW_NEW_SELLER_DAYS = 30;

const isoDate = z.string().datetime({ offset: true });
const count = z.number().int().min(0);
const rupees = z.number().int();

/** One period of sales. gatewaySales and codOrderValue are item subtotals (net of reversals); codOrders count COD orders even when the commission rate was 0. */
export const adminKpiPeriodSchema = z.object({
  gatewaySales: rupees,
  commission: rupees,
  /** SB-F1: the commission on COD orders (0 while the COD percent is 0). Absent from an older seller backend. */
  codCommission: rupees.optional(),
  gatewayOrders: count,
  codOrderValue: rupees,
  codOrders: count,
});

/** Sprint 6 (S6-B5): the KPIs the seller backend computes from the NEW CommissionEntry ledger, orders and subscriptions. Whole rupees. */
export const adminKpiSchema = z.object({
  periods: z.object({ today: adminKpiPeriodSchema, last7: adminKpiPeriodSchema, last30: adminKpiPeriodSchema }),
  ordersByPeriod: z.object({ today: count, last7: count, last30: count }),
  /** The sellers' net balance not yet settled by a payout. */
  unsettledBalance: rupees,
  ordersByStatus: z.object({ pending: count, confirmed: count, processing: count, dispatched: count, delivered: count, cancelled: count, returned: count }),
  sellersByPlan: z.array(z.object({ planKey: z.string(), status: z.string(), count })),
  topStores: z.array(z.object({ storeId: z.string(), storeName: z.string().nullable(), sales: rupees })).max(5),
});
export type AdminKpi = z.infer<typeof adminKpiSchema>;

export const adminOverviewSchema = z.object({
  stores: z.object({
    /** Stores with a known status: the sum of byStatus. */
    total: count,
    byStatus: z.object({ pending: count, active: count, suspended: count, archived: count }),
  }),
  sellers: z.object({
    /** Accounts with the seller role (ID-33: the platform has no separate seller collection). */
    total: count,
    /** Seller accounts created within the last windowDays days. */
    newInWindow: count,
    windowDays: z.number().int().min(1),
  }),
  /** Sprint 6 (S6-B5): null when the seller backend could not be reached (the rest of the overview still answers). */
  kpi: adminKpiSchema.nullable(),
  outbox: z.object({
    counts: z.object({ pending: count, sent: count, dead: count }),
    oldestPendingAt: isoDate.nullable(),
    lastSentAt: isoDate.nullable(),
  }),
  generatedAt: isoDate,
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;
