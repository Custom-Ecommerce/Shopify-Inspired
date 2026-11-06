import { z } from 'zod';
import { adminLedgerBucketSchema } from './admin-commerce';

/**
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
  /** Totals by status over the whole commission ledger. */
  ledger: z.object({ pending: adminLedgerBucketSchema, settled: adminLedgerBucketSchema, refunded: adminLedgerBucketSchema.optional() }),
  outbox: z.object({
    counts: z.object({ pending: count, sent: count, dead: count }),
    oldestPendingAt: isoDate.nullable(),
    lastSentAt: isoDate.nullable(),
  }),
  generatedAt: isoDate,
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;
