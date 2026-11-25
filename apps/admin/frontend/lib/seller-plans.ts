import type { AdminSellerPlan, EffectivePlanStatus } from "@/lib/contracts";

/**
 * Sprint 6 EP-14.US02.T08 (D-118): the wording of the sellers page's plan column. Pure: no I/O. null is unlimited.
 * Sprint 8 (S8-B5): the live API keys are shown too (the store of the seller with the most of them, against the per-store limit).
 */

export const PLAN_STATUS_TEXT: Record<EffectivePlanStatus, string> = {
  trial: "Trial",
  active: "Active",
  grace: "Grace period",
  expired: "Expired",
  cancelled: "Cancelled",
  none: "No subscription",
};

/** The badge tone of a status: a paying seller is plain, one about to lose limits stands out, one who has lost them is a warning. */
export type PlanTone = "neutral" | "secondary" | "default";
export const PLAN_STATUS_TONE: Record<EffectivePlanStatus, PlanTone> = {
  trial: "secondary",
  active: "default",
  grace: "secondary",
  expired: "neutral",
  cancelled: "neutral",
  none: "neutral",
};

/** "3 of 10", or "3 of unlimited". */
export function usageText(used: number, limit: number | null): string {
  return used + " of " + (limit === null ? "unlimited" : limit.toLocaleString("en-US"));
}

/** True when the seller has reached (or passed) a limit: the page marks it. */
export function atLimit(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}

/** S8-B5: "API keys 1 of 2". The count is the seller's store with the most live keys: the limit is per store. */
export function apiKeysText(plan: Pick<AdminSellerPlan, "used" | "limits">): string {
  return "API keys " + usageText(plan.used.apiKeys, plan.limits.apiKeys);
}

/** "5 days left" / "ends today" / "" without a date. */
export function daysLeftText(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft === 0) return "ends today";
  return daysLeft + (daysLeft === 1 ? " day left" : " days left");
}

/** The sellers on a page by id, so a row finds its plan; a seller the call did not answer for has none (the column shows a dash). */
export function plansBySeller(plans: readonly AdminSellerPlan[]): Map<string, AdminSellerPlan> {
  return new Map(plans.map((plan) => [plan.sellerId, plan]));
}

/** The ids to ask for: the sellers of the page, once each. */
export function sellerIdsOf(sellers: ReadonlyArray<{ id: string }>): string[] {
  return [...new Set(sellers.map((seller) => seller.id))];
}

/** One line for the cell under the plan name: the status and the days left. */
export function planSummaryLine(plan: Pick<AdminSellerPlan, "status" | "daysLeft">): string {
  const left = daysLeftText(plan.daysLeft);
  return PLAN_STATUS_TEXT[plan.status] + (left === "" ? "" : ", " + left);
}
