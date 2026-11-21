import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { PLAN_KEY_PATTERN } from './plans';

/**
 * Sprint 6 EP-14 (D-118): a seller's subscription and the plan they are effectively on. Money is whole rupees; a limit of null is unlimited.
 * What a seller reads is their OWN subscription and the usage of their own store (GET /api/stores/:id/plan-usage); what an admin reads is the
 * same for any seller (a signed call). The expiry job answers counts only.
 */

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'grace', 'expired', 'cancelled'] as const;
export const SUBSCRIPTION_SOURCES = ['manual', 'stripe'] as const;

/**
 * The status a seller is EFFECTIVELY in, worked out from the dates on every read: the five stored statuses, and `none` for a seller with no
 * subscription at all (the Free plan).
 */
export const EFFECTIVE_PLAN_STATUSES = ['trial', 'active', 'grace', 'expired', 'cancelled', 'none'] as const;
export type EffectivePlanStatus = (typeof EFFECTIVE_PLAN_STATUSES)[number];

const isoDate = z.string().datetime({ offset: true });
const limit = z.number().int().min(0).nullable();

export const effectivePlanLimitsSchema = z.object({
  stores: limit,
  products: limit,
  staffSeats: limit,
  apiKeys: limit,
  customDomain: z.boolean(),
  premiumThemes: z.boolean(),
});
export type EffectivePlanLimits = z.output<typeof effectivePlanLimitsSchema>;

/** What is in use against each limit. Staff seats and API keys count 0 until Sprint 8. */
export const planUsageCountsSchema = z.object({
  stores: z.number().int().min(0),
  products: z.number().int().min(0),
  staffSeats: z.number().int().min(0),
  apiKeys: z.number().int().min(0),
});
export type PlanUsageCounts = z.output<typeof planUsageCountsSchema>;

/**
 * GET /api/stores/:id/plan-usage. plan is the plan whose limits apply NOW (Free when expired, cancelled past its period or never subscribed).
 * subscribedPlanKey is the plan of the subscription itself, so the page can say "your Growth plan has expired". storeLimitOverride tells the
 * page that an admin set a store limit for this seller; limits.stores already shows it.
 */
export const planUsageSchema = z.object({
  plan: z.object({ key: z.string().min(1), name: z.string() }),
  status: z.enum(EFFECTIVE_PLAN_STATUSES),
  subscribedPlanKey: z.string().nullable(),
  limits: effectivePlanLimitsSchema,
  used: planUsageCountsSchema,
  /** The end of the paid period (or of the trial); null when there is none. */
  periodEnd: isoDate.nullable(),
  graceUntil: isoDate.nullable(),
  /** Whole days until periodEnd (or graceUntil while in grace), never below 0; null when there is no date. */
  daysLeft: z.number().int().min(0).nullable(),
  /** True when an admin set a store limit for this seller (it wins over the plan). */
  storeLimitOverridden: z.boolean(),
  /** True when the Free plan document is missing and the built-in Free limits are shown. */
  fallbackLimits: z.boolean(),
});
export type PlanUsage = z.output<typeof planUsageSchema>;

/** The 403 body of a refused add (PLAN_LIMIT_REACHED). */
export const PLAN_LIMIT_CODE = 'PLAN_LIMIT_REACHED';
export const planLimitRefusalSchema = z.object({
  code: z.literal(PLAN_LIMIT_CODE),
  /** Which limit: products or stores. */
  limitKind: z.enum(['products', 'stores']).optional(),
  limit: z.number().int().min(0),
  used: z.number().int().min(0),
  plan: z.string(),
  upgradeHint: z.string(),
});
export type PlanLimitRefusal = z.output<typeof planLimitRefusalSchema>;

/** Admin: what the sellers page shows of one seller's plan (a signed call to the seller backend). */
export const adminSellerPlanSchema = z.object({
  sellerId: objectIdSchema,
  plan: z.object({ key: z.string().min(1), name: z.string() }),
  status: z.enum(EFFECTIVE_PLAN_STATUSES),
  periodEnd: isoDate.nullable(),
  daysLeft: z.number().int().min(0).nullable(),
  limits: effectivePlanLimitsSchema,
  used: planUsageCountsSchema,
});
export type AdminSellerPlan = z.output<typeof adminSellerPlanSchema>;

export const adminSellerPlansResponseSchema = z.object({ plans: z.array(adminSellerPlanSchema) });
export type AdminSellerPlansResponse = z.output<typeof adminSellerPlansResponseSchema>;

/** Admin backend -> seller backend, signed: the plans of up to 100 sellers at once (the sellers page lists 20). */
export const internalSellerPlansRequestSchema = z
  .object({ sellerIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'sellerId must be a 24-character ObjectId')).min(1).max(100) })
  .strict();
export type InternalSellerPlansRequest = z.output<typeof internalSellerPlansRequestSchema>;

/** The key of a plan is a slug; the subscription holds one. */
export const subscriptionPlanKeySchema = z.string().regex(PLAN_KEY_PATTERN);

/**
 * The expiry job (POST /api/internal/subscriptions/expire). Dry run by default; apply only with { apply: true }. Counts only.
 *   trialToExpired      a trial ended without payment
 *   activeToGrace       the paid period ended: the plan's limits stay until graceUntil
 *   graceToExpired      the grace ended
 *   cancelledToExpired  a cancelled subscription reached the end of its paid period
 *   downgraded          (S6-B4) a downgrade the seller asked for took effect at the period end
 *   remindersQueued     (S6-B4) "ending in 7 days" emails newly queued
 *   expiredNoticesQueued (S6-B4) "expired" emails newly queued
 */
export const expiryJobRequestSchema = z.object({ apply: z.boolean().optional() }).strict();
export const expiryJobResponseSchema = z.object({
  dryRun: z.boolean(),
  scanned: z.number().int().min(0),
  trialToExpired: z.number().int().min(0),
  activeToGrace: z.number().int().min(0),
  graceToExpired: z.number().int().min(0),
  cancelledToExpired: z.number().int().min(0),
  downgraded: z.number().int().min(0),
  remindersQueued: z.number().int().min(0),
  expiredNoticesQueued: z.number().int().min(0),
  skipped: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type ExpiryJobResponse = z.output<typeof expiryJobResponseSchema>;
