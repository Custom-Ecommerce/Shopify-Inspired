import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { COMMISSION_MODES, STORE_STATUSES } from './store';

/**
 * Wire shapes of the admin console's commerce endpoints (apps/admin-portal): the commission ledger, the store
 * commission rates, and the subscription plans. Identity is id. Amounts are minor currency units; commission
 * rates are percentages (ID-18). The ledger carries only the fields the admin policy may read: no order
 * identifiers, payment intent, or application fee id.
 */

const isoDate = z.string().datetime({ offset: true });

function envelopeOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    docs: z.array(item),
    totalDocs: z.number().int().min(0),
    totalPages: z.number().int().min(0),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean(),
  });
}

/* Commission ledger. */

export const ADMIN_LEDGER_STATUSES = ['pending', 'settled', 'refunded'] as const;
export const ADMIN_PAYMENT_METHODS = ['card', 'cod'] as const;

export const adminLedgerEntrySchema = z.object({
  id: objectIdSchema,
  store: z.object({ id: objectIdSchema, name: z.string() }).nullable(),
  /** Minor units. A refund reversal is a negative row. */
  orderAmount: z.number().finite(),
  /** Percentage: 4 means 4 percent. */
  commissionRate: z.number().finite().min(0),
  /** Minor units. Negative on a refund reversal. */
  commissionAmount: z.number().finite(),
  status: z.enum(ADMIN_LEDGER_STATUSES),
  paymentMethod: z.enum(ADMIN_PAYMENT_METHODS).nullable(),
  settlementDate: isoDate.nullable(),
  settlementRef: z.string().nullable(),
  createdAt: isoDate,
});

export const adminLedgerBucketSchema = z.object({
  count: z.number().int().min(0),
  orderAmount: z.number().finite(),
  commissionAmount: z.number().finite(),
});

export const adminLedgerListSchema = envelopeOf(adminLedgerEntrySchema).extend({
  /** Totals over the whole ledger by status, not over the filtered page. */
  totals: z.object({ pending: adminLedgerBucketSchema, settled: adminLedgerBucketSchema, refunded: adminLedgerBucketSchema.optional() }),
});

/* Commission rates per store. */

export const adminCommissionRateItemSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  status: z.enum(STORE_STATUSES),
  commissionMode: z.enum(COMMISSION_MODES),
  /** The store's own rate, a percentage. Used only when the mode is custom. */
  commissionRate: z.number().finite().min(0),
  /** The rate that applies to the store's next order, or null when none can be resolved. */
  effectiveRate: z.number().finite().min(0).nullable(),
});

export const adminCommissionRatesSchema = envelopeOf(adminCommissionRateItemSchema).extend({
  /** The platform default rate, a percentage, or null when the settings hold no usable value. */
  defaultRate: z.number().finite().min(0).nullable(),
});

/* Subscription plans. */

export const ADMIN_SUBSCRIPTION_TIERS = ['basic', 'pro', 'premium'] as const;

export const adminSubscriptionPlanSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  tier: z.enum(ADMIN_SUBSCRIPTION_TIERS),
  stripePriceId: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const adminSubscriptionPlanListSchema = envelopeOf(adminSubscriptionPlanSchema).extend({
  /** Plans per tier across the whole catalogue, for the tier filter. */
  counts: z.object({
    basic: z.number().int().min(0),
    pro: z.number().int().min(0),
    premium: z.number().int().min(0),
  }),
});

export type AdminLedgerEntry = z.infer<typeof adminLedgerEntrySchema>;
export type AdminLedgerBucket = z.infer<typeof adminLedgerBucketSchema>;
export type AdminLedgerList = z.infer<typeof adminLedgerListSchema>;
export type AdminCommissionRateItem = z.infer<typeof adminCommissionRateItemSchema>;
export type AdminCommissionRates = z.infer<typeof adminCommissionRatesSchema>;
export type AdminSubscriptionPlan = z.infer<typeof adminSubscriptionPlanSchema>;
export type AdminSubscriptionPlanList = z.infer<typeof adminSubscriptionPlanListSchema>;
