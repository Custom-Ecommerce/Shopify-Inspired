/**
 * Sprint 6 EP-14.US02 (D-118): the wording and checks of the plan banner, the usage bars and the upgrade dialog. Pure: no I/O. A limit of
 * null is unlimited. Staff seats and API keys count 0 until Sprint 8, so only stores and products are shown.
 */

export type PlanStatus = "trial" | "active" | "grace" | "expired" | "cancelled" | "none";

export interface PlanUsageLimits {
  stores: number | null;
  products: number | null;
  staffSeats: number | null;
  apiKeys: number | null;
  customDomain: boolean;
  premiumThemes: boolean;
}

export interface PlanUsageData {
  plan: { key: string; name: string };
  status: PlanStatus;
  subscribedPlanKey: string | null;
  limits: PlanUsageLimits;
  used: { stores: number; products: number; staffSeats: number; apiKeys: number };
  periodEnd: string | null;
  graceUntil: string | null;
  daysLeft: number | null;
  storeLimitOverridden: boolean;
  fallbackLimits: boolean;
}

const STATUSES: readonly PlanStatus[] = ["trial", "active", "grace", "expired", "cancelled", "none"];
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isLimit = (value: unknown): value is number | null => value === null || isCount(value);

/** Reads the answer of /api/dashboard/plan-usage. Null for anything unusable: the banner is then simply not shown. */
export function readPlanUsage(body: unknown): PlanUsageData | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, any>;
  if (typeof r.plan?.key !== "string" || typeof r.plan?.name !== "string" || !STATUSES.includes(r.status)) return null;
  const l = r.limits;
  const u = r.used;
  if (typeof l !== "object" || l === null || typeof u !== "object" || u === null) return null;
  if (![l.stores, l.products, l.staffSeats, l.apiKeys].every(isLimit) || ![u.stores, u.products, u.staffSeats, u.apiKeys].every(isCount)) return null;
  return {
    plan: { key: r.plan.key, name: r.plan.name },
    status: r.status,
    subscribedPlanKey: typeof r.subscribedPlanKey === "string" ? r.subscribedPlanKey : null,
    limits: { stores: l.stores, products: l.products, staffSeats: l.staffSeats, apiKeys: l.apiKeys, customDomain: l.customDomain === true, premiumThemes: l.premiumThemes === true },
    used: { stores: u.stores, products: u.products, staffSeats: u.staffSeats, apiKeys: u.apiKeys },
    periodEnd: typeof r.periodEnd === "string" ? r.periodEnd : null,
    graceUntil: typeof r.graceUntil === "string" ? r.graceUntil : null,
    daysLeft: isCount(r.daysLeft) ? r.daysLeft : null,
    storeLimitOverridden: r.storeLimitOverridden === true,
    fallbackLimits: r.fallbackLimits === true,
  };
}

export type BarTone = "ok" | "near" | "full" | "over";

export interface UsageBar {
  label: string;
  used: number;
  limit: number | null;
  /** 0 to 100; 0 for unlimited (there is nothing to fill). */
  percent: number;
  tone: BarTone;
  /** "3 of 10", or "3 (unlimited)". */
  text: string;
}

/** One usage bar. 80 percent and up is "near", the limit is "full", past it (a seller over a limit keeps everything) is "over". */
export function usageBar(label: string, used: number, limit: number | null): UsageBar {
  if (limit === null) return { label, used, limit, percent: 0, tone: "ok", text: used + " (unlimited)" };
  const percent = limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const tone: BarTone = used > limit ? "over" : used === limit ? "full" : percent >= 80 ? "near" : "ok";
  return { label, used, limit, percent, tone, text: used + " of " + limit };
}

/** The two bars the pages show. */
export function usageBars(usage: Pick<PlanUsageData, "limits" | "used">): UsageBar[] {
  return [usageBar("Stores", usage.used.stores, usage.limits.stores), usageBar("Products", usage.used.products, usage.limits.products)];
}

const days = (count: number | null): string => (count === null ? "" : count === 0 ? "today" : count === 1 ? "1 day" : count + " days");

/** The banner's headline and one line under it. */
export function bannerText(usage: Pick<PlanUsageData, "plan" | "status" | "subscribedPlanKey" | "daysLeft">): { headline: string; detail: string } {
  const name = usage.plan.name;
  const left = days(usage.daysLeft);
  switch (usage.status) {
    case "trial":
      return { headline: name + " plan (trial)", detail: left === "" ? "Your trial is running." : "Your trial ends in " + left + (usage.daysLeft === 0 ? "." : ". Pay to keep the plan.") };
    case "active":
      return { headline: name + " plan", detail: left === "" ? "Your plan is active." : usage.daysLeft === 0 ? "Your plan ends today." : "Your plan runs for " + left + " more." };
    case "grace":
      return { headline: name + " plan: payment due", detail: "Your period has ended. You keep your plan's limits" + (left === "" ? "" : " for " + left + " more") + ". Pay to keep them." };
    case "expired":
      return { headline: "Your plan has expired", detail: "You are on the " + name + " plan's limits. Nothing was deleted: you just cannot add more past them." };
    case "cancelled":
      return { headline: "Your subscription was cancelled", detail: "You are on the " + name + " plan's limits. Nothing was deleted: you just cannot add more past them." };
    default:
      return { headline: name + " plan", detail: "Upgrade when you need more stores or products." };
  }
}

/** A banner that asks for attention: payment due, expired or cancelled. */
export function bannerNeedsAction(status: PlanStatus): boolean {
  return status === "grace" || status === "expired" || status === "cancelled";
}

// ---------------------------------------------------------------------------------------------------------------------
// The upgrade hint: a refused add (403 PLAN_LIMIT_REACHED)

export interface PlanLimitInfo {
  limitKind: "products" | "stores" | null;
  limit: number | null;
  used: number | null;
  plan: string | null;
  upgradeHint: string;
  message: string;
}

/**
 * Reads a PLAN_LIMIT_REACHED answer, from the console's proxy ({ error, code, details }) or straight from the backend ({ errors, code, ... }).
 * Null for any other answer.
 */
export function planLimitFrom(body: unknown): PlanLimitInfo | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, any>;
  if (r.code !== "PLAN_LIMIT_REACHED") return null;
  const d = typeof r.details === "object" && r.details !== null && !Array.isArray(r.details) ? (r.details as Record<string, any>) : r;
  const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const message = typeof r.error === "string" ? r.error : typeof r.errors?.[0]?.message === "string" ? r.errors[0].message : "You have reached your plan's limit.";
  return {
    limitKind: d.limitKind === "products" || d.limitKind === "stores" ? d.limitKind : null,
    limit: number(d.limit),
    used: number(d.used),
    plan: typeof d.plan === "string" ? d.plan : null,
    upgradeHint: typeof d.upgradeHint === "string" ? d.upgradeHint : "Upgrade your plan for a higher limit.",
    message,
  };
}

export const PLAN_LIMIT_EVENT = "markaz:plan-limit";

/**
 * Tells the dashboard to open the upgrade dialog when the answer was PLAN_LIMIT_REACHED. True when it was one. Safe on the server and in tests:
 * without a window it does nothing.
 */
export function announcePlanLimit(body: unknown): boolean {
  const info = planLimitFrom(body);
  if (info === null) return false;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: info }));
  return true;
}

/** The title of the dialog. */
export function upgradeTitle(info: Pick<PlanLimitInfo, "limitKind">): string {
  return info.limitKind === "stores" ? "You have reached your store limit" : info.limitKind === "products" ? "You have reached your product limit" : "You have reached your plan limit";
}

/** "You have 10 of 10 products on the Free plan." */
export function upgradeSummary(info: Pick<PlanLimitInfo, "limitKind" | "limit" | "used" | "plan"> & { message?: string }): string {
  if (info.limit === null || info.used === null) return info.message ?? "";
  const noun = info.limitKind === "stores" ? "stores" : "products";
  return "You have " + info.used + " of " + info.limit + " " + noun + (info.plan ? " on the " + info.plan + " plan" : "") + ".";
}
