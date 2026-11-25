import type { Analytics, AnalyticsFunnel, AnalyticsFunnelStep, AnalyticsPeriod } from "@markaz/contracts/analytics";

/**
 * Sprint 8 (S8-B7, D-118): the analytics page's words and small sums. Pure: no I/O. The funnel numbers are counters, not unique people, and the page says so.
 */

export const PERIODS: readonly AnalyticsPeriod[] = ["7d", "30d", "90d"];
export const PERIOD_LABELS: Record<AnalyticsPeriod, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

export const STEP_LABELS: Record<AnalyticsFunnelStep, string> = {
  visits: "Visits",
  productViews: "Product views",
  addToCart: "Added to cart",
  checkoutStarts: "Started checkout",
  orders: "Orders",
};

export const COUNTERS_NOTE = "These count actions, not people. One visit is one browser session; one visitor can view many products or order twice.";
export const NO_VISITS_TITLE = "No visits yet";
export const NO_VISITS_TEXT = "Visits appear here after shoppers open your live store.";
export const NOT_ALLOWED_TEXT = "Only the store owner and managers can see analytics.";

export const hasVisits = (data: Pick<Analytics, "traffic" | "funnel">): boolean =>
  data.traffic.some((day) => day.visits > 0) || data.funnel.steps.some((step) => step.count > 0);

export const percentText = (value: number): string => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

export interface FunnelBar {
  key: AnalyticsFunnelStep;
  label: string;
  count: number;
  /** The width of the bar, 0 to 100: the share of the first step. */
  width: number;
  note: string;
}

export function funnelBars(funnel: AnalyticsFunnel): FunnelBar[] {
  return funnel.steps.map((step) => ({
    key: step.key,
    label: STEP_LABELS[step.key],
    count: step.count,
    width: Math.max(0, Math.min(100, step.fromStart)),
    note: step.fromPrevious === null ? "Start" : `${percentText(step.fromPrevious)} of the step before`,
  }));
}

export const overallText = (funnel: Pick<AnalyticsFunnel, "overall">): string => `${percentText(funnel.overall)} of visits ended in an order`;

export const shortDay = (date: string): string => date.slice(5);

/** The config of the "Orders by Status" chart: one entry per status, so the legend names each slice (not the value it counts). */
export function statusLegendConfig(statuses: readonly string[]): Record<string, { label: string }> {
  return Object.fromEntries([...statuses.map((status) => [status, { label: status.charAt(0).toUpperCase() + status.slice(1) }]), ["value", { label: "Orders" }]]);
}
