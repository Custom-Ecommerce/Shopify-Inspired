/**
 * Sprint 6 EP-12.US02.T03 (D-118): the wording, checks and request of the Store limit dialog on the sellers page. Pure: no I/O. The
 * backend checks everything again; these only keep a form from sending what cannot work and keep the wording in one place.
 */

export const STORE_LIMIT_MIN = 1;
export const STORE_LIMIT_MAX = 1000;
export const STORE_LIMIT_REASON_MIN = 3;
export const STORE_LIMIT_REASON_MAX = 300;

export type StoreLimitSourceValue = "override" | "plan" | "setting" | "env";

/** Where the effective limit comes from, in words an operator reads. The order is the order of precedence. */
export const STORE_LIMIT_SOURCE_LABELS: Record<StoreLimitSourceValue, string> = {
  override: "Set for this seller by an operator (override)",
  plan: "The seller's subscription plan",
  setting: "The platform setting, Stores per seller",
  env: "The platform default (environment)",
};

export interface StoreLimitView {
  storeLimitOverride: number | null;
  effectiveLimit: number;
  source: StoreLimitSourceValue;
  storesUsed: number;
  planLimit: number | null;
  platformMax: number | null;
  envMax: number;
}

/** "3 stores" / "1 store". */
export function storesLabel(count: number): string {
  return count + (count === 1 ? " store" : " stores");
}

/** The sentence under the title: the effective limit, how many the seller has, and where the limit comes from. */
export function describeEffectiveLimit(view: Pick<StoreLimitView, "effectiveLimit" | "source" | "storesUsed">): string {
  return "Effective limit: " + storesLabel(view.effectiveLimit) + " (" + STORE_LIMIT_SOURCE_LABELS[view.source] + "). The seller has " + storesLabel(view.storesUsed) + ".";
}

/** What the limit would be without the override: plan, then the platform setting, then the environment. */
export function limitWithoutOverride(view: Pick<StoreLimitView, "planLimit" | "platformMax" | "envMax">): { limit: number; source: StoreLimitSourceValue } {
  if (view.planLimit !== null) return { limit: view.planLimit, source: "plan" };
  if (view.platformMax !== null) return { limit: view.platformMax, source: "setting" };
  return { limit: view.envMax, source: "env" };
}

const LIMIT_TEXT = /^\d{1,4}$/;

/** The limit typed, or null when it is not a whole number from 1 to 1000. */
export function parseStoreLimitInput(text: string): number | null {
  const trimmed = text.trim();
  if (!LIMIT_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= STORE_LIMIT_MIN && value <= STORE_LIMIT_MAX ? value : null;
}

export interface StoreLimitFormValues {
  /** True: remove the override, so the plan, the platform setting or the environment decides. */
  clear: boolean;
  value: string;
  reason: string;
}

export type StoreLimitFormErrors = Partial<Record<"value" | "reason", string>>;

export function validateStoreLimitForm(values: StoreLimitFormValues): StoreLimitFormErrors {
  const errors: StoreLimitFormErrors = {};
  if (!values.clear) {
    if (values.value.trim() === "") errors.value = "Enter a store limit.";
    else if (parseStoreLimitInput(values.value) === null) errors.value = "Enter a whole number from " + STORE_LIMIT_MIN + " to " + STORE_LIMIT_MAX + ".";
  }
  const reason = values.reason.trim();
  if (reason.length < STORE_LIMIT_REASON_MIN || reason.length > STORE_LIMIT_REASON_MAX) {
    errors.reason = "Give a reason of " + STORE_LIMIT_REASON_MIN + " to " + STORE_LIMIT_REASON_MAX + " characters.";
  }
  return errors;
}

/** The request body. Call it with values that passed validateStoreLimitForm. */
export function toStoreLimitRequest(values: StoreLimitFormValues): { storeLimitOverride: number | null; reason: string } {
  return { storeLimitOverride: values.clear ? null : parseStoreLimitInput(values.value), reason: values.reason.trim() };
}

/** True when the new override equals the one the seller already has (nothing to send). */
export function isUnchanged(values: StoreLimitFormValues, view: Pick<StoreLimitView, "storeLimitOverride">): boolean {
  if (values.clear) return view.storeLimitOverride === null;
  return parseStoreLimitInput(values.value) === view.storeLimitOverride;
}

/**
 * A note when the new limit is below what the seller already has: nothing is deleted, the seller keeps every store and is only blocked
 * from adding more. Null when there is nothing to say.
 */
export function overLimitNote(storesUsed: number, newLimit: number): string | null {
  if (storesUsed <= newLimit) return null;
  return "The seller already has " + storesLabel(storesUsed) + ". They keep them all and cannot add more until they are under " + storesLabel(newLimit) + ".";
}

/** Maps the backend's validation issues onto the form fields. */
export function storeLimitIssuesToErrors(issues: Array<{ path: string; message: string }>): StoreLimitFormErrors {
  const errors: StoreLimitFormErrors = {};
  for (const issue of issues) {
    const field = issue.path === "storeLimitOverride" ? "value" : issue.path === "reason" ? "reason" : null;
    if (field !== null) errors[field] = issue.message.charAt(0).toUpperCase() + issue.message.slice(1) + (issue.message.endsWith(".") ? "" : ".");
  }
  return errors;
}
