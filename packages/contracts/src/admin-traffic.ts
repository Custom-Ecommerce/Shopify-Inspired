import { z } from 'zod';

/*
 * Sprint 8 (S8-B7, D-118): the admin overview's platform traffic: visits (counted browser sessions) and new orders per UTC day, the last 14 days. Sums of the
 * anonymous counters: no store and no person.
 */

export const ADMIN_TRAFFIC_DAYS = 14;

export const adminTrafficSchema = z.object({
  days: z.array(z.object({ day: z.string(), visits: z.number().int().min(0), orders: z.number().int().min(0) })),
});
export type AdminTraffic = z.output<typeof adminTrafficSchema>;
