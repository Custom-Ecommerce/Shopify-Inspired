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

/** The limits of a plan as the console lists them. null is unlimited. */
const adminPlanLimitsSchema = z.object({
  stores: z.number().int().min(0).nullable(),
  products: z.number().int().min(0).nullable(),
  staffSeats: z.number().int().min(0).nullable(),
  apiKeys: z.number().int().min(0).nullable(),
  customDomain: z.boolean(),
  premiumThemes: z.boolean(),
});

/**
 * Sprint 6 (D-118): plans are data. A plan from before Sprint 6 has only a name, a Stripe price and a tier: its key, price and limits are
 * null here, and a new plan has no tier. Every Sprint 6 field has a default, so an older backend's answer still parses.
 */
export const adminSubscriptionPlanSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  tier: z.enum(ADMIN_SUBSCRIPTION_TIERS).nullable().default(null),
  stripePriceId: z.string().nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
  key: z.string().nullable().default(null),
  /** Whole rupees; null for an old plan. */
  priceRs: z.number().int().min(0).nullable().default(null),
  interval: z.enum(['month']).default('month'),
  limits: adminPlanLimitsSchema.nullable().default(null),
  features: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  /** The compare-and-set counter of the write routes. */
  revision: z.number().int().min(0).default(0),
  archivedAt: isoDate.nullable().default(null),
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
