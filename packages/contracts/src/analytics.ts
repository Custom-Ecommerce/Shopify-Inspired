import { z } from 'zod';

/** The periods the analytics page offers. */
export const ANALYTICS_PERIODS = ['7d', '30d', '90d'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

const count = z.number().int().min(0);
const percentage = z.number().min(0).max(100);

export const ANALYTICS_FUNNEL_STEPS = ['visits', 'productViews', 'addToCart', 'checkoutStarts', 'orders'] as const;
export type AnalyticsFunnelStep = (typeof ANALYTICS_FUNNEL_STEPS)[number];

/**
 * Sprint 8 (S8-B7, D-118): the funnel. These are COUNTERS, NOT UNIQUE PEOPLE: a visit is one browser session, but one visitor can view many products, add several
 * times and order more than once, and a browser with Do Not Track orders without being counted. So a step can be larger than the one before it.
 * fromPrevious (null on the first step), fromStart and overall are percentages with one decimal: 0 when there is nothing to divide by, never above 100.
 */
export const analyticsFunnelSchema = z.object({
  steps: z.array(z.object({ key: z.enum(ANALYTICS_FUNNEL_STEPS), count, fromPrevious: percentage.nullable(), fromStart: percentage })),
  overall: percentage,
});
export type AnalyticsFunnel = z.infer<typeof analyticsFunnelSchema>;

/** GET /api/analytics. The shape the seller analytics page reads (ID-28, S8-B7). Days are UTC; money is whole rupees. */
export const analyticsSchema = z.object({
  period: z.enum(ANALYTICS_PERIODS),
  totalOrders: count,
  avgOrderValue: z.number().min(0),
  ordersByStatus: z.record(z.string(), count),
  revenue: z.object({
    daily: z.array(z.object({ date: z.string(), amount: z.number().min(0), orders: count })),
  }),
  topCities: z.array(z.object({ city: z.string(), orders: count })),
  topProducts: z.array(z.object({ id: z.string(), title: z.string(), revenue: z.number().min(0), orders: count })),
  funnel: analyticsFunnelSchema,
  /** Visits (counted browser sessions) per UTC day, every day of the period, 0 where none. */
  traffic: z.array(z.object({ date: z.string(), visits: count })),
  topByViews: z.array(z.object({ name: z.string(), slug: z.string(), views: count })),
  topByOrders: z.array(z.object({ name: z.string(), slug: z.string().nullable(), orders: count })),
});

export type Analytics = z.infer<typeof analyticsSchema>;
