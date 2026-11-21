import type { AdminSubscriptionPlan } from "@/lib/contracts";

/**
 * Sprint 6 EP-14.US01 (D-118): the checks, labels and requests of the plan screens (create, edit, archive). Pure: no I/O. The backend checks
 * everything again; these only keep a form from sending what cannot work and keep the wording in one place.
 * Money is WHOLE RUPEES. A limit left empty is UNLIMITED (null on the wire).
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
/** The plan every seller falls back to; it cannot be archived. */
export const PROTECTED_PLAN_KEYS: readonly string[] = ["free"];

export const LIMIT_FIELDS = ["stores", "products", "staffSeats", "apiKeys"] as const;
export type LimitField = (typeof LIMIT_FIELDS)[number];

export const LIMIT_LABELS: Record<LimitField, string> = { stores: "Stores", products: "Products", staffSeats: "Staff seats", apiKeys: "API keys" };

/** The form holds text for every field, so an input is never uncontrolled. The limit texts are empty for unlimited. */
export interface PlanFormValues {
  key: string;
  name: string;
  priceRs: string;
  stores: string;
  products: string;
  staffSeats: string;
  apiKeys: string;
  customDomain: boolean;
  premiumThemes: boolean;
  /** One feature per line. */
  features: string;
  sortOrder: string;
  stripePriceId: string;
  reason: string;
}

export type PlanFormField = keyof PlanFormValues;
export type PlanFormErrors = Partial<Record<PlanFormField, string>>;

export function emptyPlanForm(): PlanFormValues {
  return { key: "", name: "", priceRs: "", stores: "1", products: "", staffSeats: "0", apiKeys: "0", customDomain: false, premiumThemes: false, features: "", sortOrder: "0", stripePriceId: "", reason: "" };
}

const limitText = (value: number | null | undefined): string => (typeof value === "number" ? String(value) : "");

/** The edit form of a plan. An old plan (no limits) starts from the empty form's limits; its key shows as typed text. */
export function formFromPlan(plan: AdminSubscriptionPlan): PlanFormValues {
  return {
    key: plan.key ?? "",
    name: plan.name,
    priceRs: plan.priceRs === null ? "" : String(plan.priceRs),
    stores: plan.limits ? limitText(plan.limits.stores) : "1",
    products: plan.limits ? limitText(plan.limits.products) : "",
    staffSeats: plan.limits ? limitText(plan.limits.staffSeats) : "0",
    apiKeys: plan.limits ? limitText(plan.limits.apiKeys) : "0",
    customDomain: plan.limits?.customDomain === true,
    premiumThemes: plan.limits?.premiumThemes === true,
    features: plan.features.join("\n"),
    sortOrder: String(plan.sortOrder),
    stripePriceId: plan.stripePriceId ?? "",
    reason: "",
  };
}

/** Whole rupees from what was typed ("2500", "2,500", " 0 "), or null. A fraction, a sign or a letter is not whole rupees. */
export function parseRupees(text: string): number | null {
  const clean = text.trim().replace(/,/g, "");
  if (!/^\d{1,8}$/.test(clean)) return null;
  const value = Number(clean);
  return value <= PLAN_PRICE_MAX ? value : null;
}

/** A limit typed: empty is unlimited (null); a whole number of min or more is that number; anything else is undefined (not valid). */
export function parseLimit(text: string, min: number): number | null | undefined {
  const clean = text.trim();
  if (clean === "") return null;
  if (!/^\d{1,7}$/.test(clean)) return undefined;
  const value = Number(clean);
  return value >= min && value <= PLAN_LIMIT_MAX ? value : undefined;
}

/** The feature lines: trimmed, empty lines dropped. */
export function parseFeatures(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function parseSortOrder(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,4}$/.test(clean)) return null;
  const value = Number(clean);
  return value <= PLAN_SORT_ORDER_MAX ? value : null;
}

const MIN_OF: Record<LimitField, number> = { stores: 1, products: 0, staffSeats: 0, apiKeys: 0 };

export type PlanMode = "create" | "edit";

/** The same rules the backend enforces. The reason is always required. */
export function validatePlanForm(values: PlanFormValues, mode: PlanMode): PlanFormErrors {
  const errors: PlanFormErrors = {};
  if (mode === "create" && !PLAN_KEY_PATTERN.test(values.key.trim())) {
    errors.key = "Use 2 to 30 lower case letters, digits or hyphens, starting with a letter.";
  }
  const name = values.name.trim();
  if (name.length < PLAN_NAME_MIN || name.length > PLAN_NAME_MAX) errors.name = "The plan name must be " + PLAN_NAME_MIN + " to " + PLAN_NAME_MAX + " characters.";
  else if (/[<>]/.test(name)) errors.name = "Use plain text: < and > are not allowed.";

  if (values.priceRs.trim() === "") errors.priceRs = "Enter a price in rupees (0 for free).";
  else if (parseRupees(values.priceRs) === null) errors.priceRs = "The price must be whole rupees, from 0 to " + PLAN_PRICE_MAX + ".";

  for (const field of LIMIT_FIELDS) {
    if (parseLimit(values[field], MIN_OF[field]) === undefined) {
      errors[field] = "Enter a whole number of " + MIN_OF[field] + " or more, or leave it empty for unlimited.";
    }
  }

  const features = parseFeatures(values.features);
  if (features.length > PLAN_FEATURES_MAX) errors.features = "A plan can list at most " + PLAN_FEATURES_MAX + " features.";
  else if (features.some((line) => line.length > PLAN_FEATURE_MAX)) errors.features = "A feature can be at most " + PLAN_FEATURE_MAX + " characters.";
  else if (features.some((line) => /[<>]/.test(line))) errors.features = "Use plain text: < and > are not allowed.";

  if (parseSortOrder(values.sortOrder) === null) errors.sortOrder = "The sort order is a whole number from 0 to " + PLAN_SORT_ORDER_MAX + ".";

  const price = values.stripePriceId.trim();
  if (price !== "" && !/^price_[A-Za-z0-9_]{4,100}$/.test(price)) errors.stripePriceId = "A Stripe price id looks like price_ followed by letters and digits.";

  const reason = values.reason.trim();
  if (reason.length < PLAN_REASON_MIN || reason.length > PLAN_REASON_MAX) errors.reason = "Give a reason of " + PLAN_REASON_MIN + " to " + PLAN_REASON_MAX + " characters.";
  return errors;
}

/** The limits as the wire has them. Call it with values that passed validatePlanForm. */
export function limitsOf(values: PlanFormValues) {
  return {
    stores: parseLimit(values.stores, 1) ?? null,
    products: parseLimit(values.products, 0) ?? null,
    staffSeats: parseLimit(values.staffSeats, 0) ?? null,
    apiKeys: parseLimit(values.apiKeys, 0) ?? null,
    customDomain: values.customDomain,
    premiumThemes: values.premiumThemes,
  };
}

export function toCreateRequest(values: PlanFormValues) {
  const price = values.stripePriceId.trim();
  return {
    key: values.key.trim(),
    name: values.name.trim(),
    priceRs: parseRupees(values.priceRs) ?? 0,
    limits: limitsOf(values),
    features: parseFeatures(values.features),
    sortOrder: parseSortOrder(values.sortOrder) ?? 0,
    ...(price === "" ? {} : { stripePriceId: price }),
    reason: values.reason.trim(),
  };
}

type LimitsWire = ReturnType<typeof limitsOf>;

const sameLimits = (a: LimitsWire, b: AdminSubscriptionPlan["limits"]): boolean =>
  b !== null && LIMIT_FIELDS.every((field) => a[field] === b[field]) && a.customDomain === b.customDomain && a.premiumThemes === b.premiumThemes;

/** The fields whose value in the form differs from the plan as loaded, in form order. */
export function changedPlanFields(values: PlanFormValues, plan: AdminSubscriptionPlan): Array<"name" | "priceRs" | "limits" | "features" | "sortOrder" | "stripePriceId"> {
  const changed: Array<"name" | "priceRs" | "limits" | "features" | "sortOrder" | "stripePriceId"> = [];
  if (values.name.trim() !== plan.name) changed.push("name");
  if (parseRupees(values.priceRs) !== plan.priceRs) changed.push("priceRs");
  if (!sameLimits(limitsOf(values), plan.limits)) changed.push("limits");
  const features = parseFeatures(values.features);
  if (features.length !== plan.features.length || features.some((line, index) => line !== plan.features[index])) changed.push("features");
  if (parseSortOrder(values.sortOrder) !== plan.sortOrder) changed.push("sortOrder");
  if ((values.stripePriceId.trim() === "" ? null : values.stripePriceId.trim()) !== plan.stripePriceId) changed.push("stripePriceId");
  return changed;
}

/**
 * The update body: only what changed, the revision the admin saw, and the reason. The key never goes. Limits are sent whole when any limit
 * changed. Call it with values that passed validatePlanForm.
 */
export function toUpdateRequest(values: PlanFormValues, plan: AdminSubscriptionPlan) {
  const request: Record<string, unknown> = { revision: plan.revision };
  for (const field of changedPlanFields(values, plan)) {
    if (field === "name") request.name = values.name.trim();
    else if (field === "priceRs") request.priceRs = parseRupees(values.priceRs);
    else if (field === "limits") request.limits = limitsOf(values);
    else if (field === "features") request.features = parseFeatures(values.features);
    else if (field === "sortOrder") request.sortOrder = parseSortOrder(values.sortOrder);
    else request.stripePriceId = values.stripePriceId.trim() === "" ? null : values.stripePriceId.trim();
  }
  request.reason = values.reason.trim();
  return request as { revision: number; reason: string } & Record<string, unknown>;
}

/** What an archive sends. */
export function toArchiveRequest(plan: Pick<AdminSubscriptionPlan, "revision">, reason: string): { revision: number; reason: string } {
  return { revision: plan.revision, reason: reason.trim() };
}

export function archiveReasonProblem(reason: string): string | null {
  const length = reason.trim().length;
  return length < PLAN_REASON_MIN || length > PLAN_REASON_MAX ? "Give a reason of " + PLAN_REASON_MIN + " to " + PLAN_REASON_MAX + " characters." : null;
}

/** "Unlimited" for null, else the number with separators. */
export function limitLabel(value: number | null): string {
  return value === null ? "Unlimited" : value.toLocaleString("en-US");
}

/** "Rs. 2,500", or "Free" for 0 and "-" for an old plan with no price. */
export function priceLabel(priceRs: number | null): string {
  if (priceRs === null) return "-";
  return priceRs === 0 ? "Free" : "Rs. " + priceRs.toLocaleString("en-US") + " / month";
}

/** The one line under a plan's name: its limits. An old plan has none. */
export function limitsSummary(limits: AdminSubscriptionPlan["limits"]): string {
  if (limits === null) return "Old plan: no limits set";
  const parts = [
    limitLabel(limits.stores) + (limits.stores === 1 ? " store" : " stores"),
    limitLabel(limits.products) + " products",
    limitLabel(limits.staffSeats) + " staff",
    limitLabel(limits.apiKeys) + " API keys",
  ];
  if (limits.customDomain) parts.push("custom domain");
  if (limits.premiumThemes) parts.push("premium themes");
  return parts.join(", ");
}

export type PlanStatus = "active" | "archived" | "old";

/** A plan from before Sprint 6 (no key) is "old": it is listed and can be edited, but it has no limits to enforce. */
export function planStatus(plan: Pick<AdminSubscriptionPlan, "isActive" | "key">): PlanStatus {
  if (!plan.isActive) return "archived";
  return plan.key === null ? "old" : "active";
}

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = { active: "On sale", archived: "Archived", old: "Old plan" };

/** Whether the Archive action is offered: not for an archived plan and not for the Free plan. */
export function canArchive(plan: Pick<AdminSubscriptionPlan, "isActive" | "key">): boolean {
  return plan.isActive && !(plan.key !== null && PROTECTED_PLAN_KEYS.includes(plan.key));
}

/** Maps the backend's validation issues onto the form fields. Issues about anything else are dropped. */
export function planIssuesToErrors(issues: Array<{ path: string; message: string }>): PlanFormErrors {
  const errors: PlanFormErrors = {};
  for (const issue of issues) {
    const head = issue.path.split(".")[0] ?? "";
    const field = head === "limits" ? ((issue.path.split(".")[1] ?? "") as PlanFormField) : (head as PlanFormField);
    if (field in emptyPlanForm() && errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}

/** A duplicate key is a 409 whose message names the key: it belongs on the key field. */
export function conflictField(status: number, message: string): "key" | null {
  return status === 409 && /key/i.test(message) ? "key" : null;
}
