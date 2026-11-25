import type { PipelineStage } from 'mongoose';
import type { AdminTraffic } from '@markaz/contracts';
import { ADMIN_TRAFFIC_DAYS } from '@/lib/contracts';
import { assertCan, DailyStat } from '@/lib/services';

/*
 * Sprint 8 (S8-B7, D-118): the platform's visits and orders per day for the admin overview, from the anonymous counters. ONE aggregation over a bounded
 * window (the last 14 UTC days, index {day}); no store, no person, only sums.
 */

const DAY_MS = 86_400_000;

export function trafficDays(now: Date): string[] {
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return Array.from({ length: ADMIN_TRAFFIC_DAYS }, (_, i) => new Date(today - (ADMIN_TRAFFIC_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

export function trafficPipeline(days: readonly string[]): Array<Record<string, unknown>> {
  return [
    { $match: { day: { $gte: days[0], $lte: days[days.length - 1] } } },
    { $group: { _id: '$day', visits: { $sum: '$visits' }, orders: { $sum: '$orders' } } },
  ];
}

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

export async function buildAdminTraffic(now: Date = new Date()): Promise<AdminTraffic> {
  assertCan('admin', 'read', 'stores');
  const days = trafficDays(now);
  const rows = (await DailyStat.aggregate(trafficPipeline(days) as unknown as PipelineStage[])) as unknown as Array<{ _id: unknown; visits?: unknown; orders?: unknown }>;
  const byDay = new Map(rows.map((row) => [String(row._id), row]));
  return { days: days.map((day) => ({ day, visits: whole(byDay.get(day)?.visits), orders: whole(byDay.get(day)?.orders) })) };
}
