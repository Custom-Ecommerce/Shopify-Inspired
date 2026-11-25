import { z } from 'zod';
import { adminSubscriptionPlanSchema } from './admin-commerce';

/**
 * Sprint 6 EP-14 (D-118): subscription plans are data. The wire shapes of the admin routes (create, update, archive, the admin view) and
 * of the public view a seller reads (GET /api/plans). Money is WHOLE RUPEES: priceRs is an integer. A limit is a whole number of 0 or more,
 * or null for unlimited. Every request is a strict object, so an unknown field is refused, and each problem names its field.
 */

export const PLAN_KEY_PATTERN = /^[a-z][a-z0-9-]{1,29}$/;
export const PLAN_NAME_MIN = 2;
export const PLAN_NAME_MAX = 60;
export const PLAN_PRICE_MAX = 10_000_000;
export const PLAN_LIMIT_MAX = 1_000_000;
export const PLAN_FEATURES_MAX = 12;
export const PLAN_FEATURE_MAX = 80;
export const PLAN_SORT_ORDER_MAX = 1000;
export const PLAN_REASON_MIN = 3;
export const PLAN_REASON_MAX = 300;
export const PLAN_INTERVALS = ['month'] as const;

/** Plain text: no tag or angle bracket, so a feature line can never carry markup. */
const plainText = (value: string): boolean => !/[<>]/.test(value);

export const planKeySchema = z
  .string({ error: 'The plan key is required.' })
  .trim()
  .regex(PLAN_KEY_PATTERN, 'Use 2 to 30 lower case letters, digits or hyphens, starting with a letter.');

export const planNameSchema = z
  .string({ error: 'The plan name is required.' })
  .trim()
  .min(PLAN_NAME_MIN, 'The plan name must be at least ' + PLAN_NAME_MIN + ' characters.')
  .max(PLAN_NAME_MAX, 'The plan name can be at most ' + PLAN_NAME_MAX + ' characters.')
  .refine(plainText, 'Use plain text: < and > are not allowed.');

/** Whole rupees. 0 is allowed (the Free plan). A fraction is refused. */
export const planPriceSchema = z
  .number({ error: 'The price must be a number of rupees.' })
  .int('The price must be whole rupees.')
  .min(0, 'The price cannot be negative.')
  .max(PLAN_PRICE_MAX, 'The price can be at most ' + PLAN_PRICE_MAX + ' rupees.');

const limitOf = (label: string, min: number) =>
  z
    .number({ error: 'The ' + label + ' limit must be a whole number, or empty for unlimited.' })
    .int('The ' + label + ' limit must be a whole number.')
    .min(min, 'The ' + label + ' limit must be at least ' + min + '.')
    .max(PLAN_LIMIT_MAX, 'The ' + label + ' limit can be at most ' + PLAN_LIMIT_MAX + '.')
    .nullable();

/** null is unlimited. A plan needs at least one store when it has a number. */
export const planLimitsSchema = z
  .object({
    stores: limitOf('store', 1),
    products: limitOf('product', 0),
    staffSeats: limitOf('staff seat', 0),
    apiKeys: limitOf('API key', 0),
    customDomain: z.boolean({ error: 'Choose yes or no for the custom domain.' }),
    premiumThemes: z.boolean({ error: 'Choose yes or no for the premium themes.' }),
  })
  .strict();
export type PlanLimits = z.output<typeof planLimitsSchema>;

export const planFeaturesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'A feature cannot be empty.')
      .max(PLAN_FEATURE_MAX, 'A feature can be at most ' + PLAN_FEATURE_MAX + ' characters.')
      .refine(plainText, 'Use plain text: < and > are not allowed.'),
  )
  .max(PLAN_FEATURES_MAX, 'A plan can list at most ' + PLAN_FEATURES_MAX + ' features.');

export const planSortOrderSchema = z
  .number({ error: 'The sort order must be a whole number.' })
  .int('The sort order must be a whole number.')
  .min(0, 'The sort order cannot be negative.')
  .max(PLAN_SORT_ORDER_MAX, 'The sort order can be at most ' + PLAN_SORT_ORDER_MAX + '.');

/** The Stripe price id is optional: a plan paid by hand has none. */
export const planStripePriceSchema = z
  .string()
  .trim()
  .regex(/^price_[A-Za-z0-9_]{4,100}$/, 'A Stripe price id looks like price_ followed by letters and digits.')
  .nullable();

export const planReasonSchema = z
  .string({ error: 'Give a reason.' })
  .trim()
  .min(PLAN_REASON_MIN, 'Give a reason of ' + PLAN_REASON_MIN + ' to ' + PLAN_REASON_MAX + ' characters.')
  .max(PLAN_REASON_MAX, 'The reason can be at most ' + PLAN_REASON_MAX + ' characters.');

const revisionSchema = z.number({ error: 'The revision is required.' }).int('The revision must be a whole number.').min(0, 'The revision cannot be negative.');

/** POST /api/admin/subscription-plans */
export const createPlanRequestSchema = z
  .object({
    key: planKeySchema,
    name: planNameSchema,
    priceRs: planPriceSchema,
    limits: planLimitsSchema,
    features: planFeaturesSchema.default([]),
    sortOrder: planSortOrderSchema.default(0),
    stripePriceId: planStripePriceSchema.optional(),
    reason: planReasonSchema,
  })
  .strict();
export type CreatePlanRequest = z.output<typeof createPlanRequestSchema>;

export const PLAN_UPDATE_FIELDS = ['name', 'priceRs', 'limits', 'features', 'sortOrder', 'stripePriceId', 'isActive'] as const;

/**
 * PATCH /api/admin/subscription-plans/:id. Only the fields sent change; limits is replaced as a whole. The key never changes. revision is
 * the one the admin saw: the write applies only if it is still the plan's revision (409 otherwise).
 */
export const updatePlanRequestSchema = z
  .object({
    revision: revisionSchema,
    name: planNameSchema.optional(),
    priceRs: planPriceSchema.optional(),
    limits: planLimitsSchema.optional(),
    features: planFeaturesSchema.optional(),
    sortOrder: planSortOrderSchema.optional(),
    stripePriceId: planStripePriceSchema.optional(),
    isActive: z.boolean({ error: 'Choose yes or no.' }).optional(),
    reason: planReasonSchema,
  })
  .strict()
  .refine((value) => PLAN_UPDATE_FIELDS.some((field) => value[field] !== undefined), { message: 'Change at least one field.', path: ['name'] });
export type UpdatePlanRequest = z.output<typeof updatePlanRequestSchema>;

/** POST /api/admin/subscription-plans/:id/archive. Archiving is the only removal: nothing is ever deleted. */
export const archivePlanRequestSchema = z.object({ revision: revisionSchema, reason: planReasonSchema }).strict();
export type ArchivePlanRequest = z.output<typeof archivePlanRequestSchema>;

/** What a seller may read of a plan (GET /api/plans): no Stripe id, no revision, no archive data. */
export const publicPlanSchema = z.object({
  key: z.string(),
  name: z.string(),
  priceRs: z.number().int().min(0),
  interval: z.enum(PLAN_INTERVALS),
  limits: planLimitsSchema,
  features: z.array(z.string()),
  sortOrder: z.number().int(),
});
export type PublicPlan = z.output<typeof publicPlanSchema>;

export const publicPlanListSchema = z.object({ plans: z.array(publicPlanSchema) });
export type PublicPlanList = z.output<typeof publicPlanListSchema>;

/** The plan as the admin console reads it after a write: the same row the list shows. */
export const adminPlanWriteResponseSchema = z.object({ plan: adminSubscriptionPlanSchema });
export type AdminPlanWriteResponse = z.output<typeof adminPlanWriteResponseSchema>;
