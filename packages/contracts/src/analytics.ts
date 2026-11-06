import { z } from 'zod';

/** The periods the analytics page offers. */
export const ANALYTICS_PERIODS = ['7d', '30d', '90d'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

/** GET /api/analytics. The shape the seller analytics page reads (ID-28). */
export const analyticsSchema = z.object({
  period: z.enum(ANALYTICS_PERIODS),
  totalOrders: z.number().int().min(0),
  avgOrderValue: z.number().min(0),
  ordersByStatus: z.record(z.string(), z.number().int().min(0)),
  revenue: z.object({
    daily: z.array(z.object({ date: z.string(), amount: z.number().min(0) })),
  }),
  topCities: z.array(z.object({ city: z.string(), orders: z.number().int().min(0) })),
  topProducts: z.array(
    z.object({ id: z.string(), title: z.string(), revenue: z.number().min(0), orders: z.number().int().min(0) }),
  ),
});

export type Analytics = z.infer<typeof analyticsSchema>;
