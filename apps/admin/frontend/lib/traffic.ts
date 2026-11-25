import type { AdminTraffic } from "@markaz/contracts/admin-traffic";

/** Sprint 8 (S8-B7, D-118): the words and bar widths of the overview's traffic card. Pure. */

export const TRAFFIC_NOTE = "Counted browser sessions and new orders of every store, per day (UTC). Counters, not people.";
export const NO_TRAFFIC_TEXT = "No visits or orders counted yet.";

export interface TrafficBar {
  day: string;
  label: string;
  visits: number;
  orders: number;
  /** 0 to 100: against the busiest day for visits. */
  width: number;
}

export function trafficBars(traffic: AdminTraffic): TrafficBar[] {
  const most = Math.max(0, ...traffic.days.map((day) => day.visits));
  return traffic.days.map((day) => ({
    day: day.day,
    label: new Date(day.day + "T00:00:00.000Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    visits: day.visits,
    orders: day.orders,
    width: most === 0 ? 0 : Math.round((day.visits / most) * 100),
  }));
}

export const hasTraffic = (traffic: AdminTraffic): boolean => traffic.days.some((day) => day.visits > 0 || day.orders > 0);

export function trafficTotals(traffic: AdminTraffic): { visits: number; orders: number } {
  return traffic.days.reduce((sum, day) => ({ visits: sum.visits + day.visits, orders: sum.orders + day.orders }), { visits: 0, orders: 0 });
}

export const totalsText = (traffic: AdminTraffic): string => {
  const totals = trafficTotals(traffic);
  return totals.visits.toLocaleString("en-US") + " visits and " + totals.orders.toLocaleString("en-US") + " orders in " + traffic.days.length + " days";
};
