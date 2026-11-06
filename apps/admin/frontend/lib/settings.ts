import {
  ADMIN_SETTINGS_MAX_STORES_MAX,
  ADMIN_SETTINGS_MAX_STORES_MIN,
  ADMIN_SETTINGS_NOTE_MAX,
  ADMIN_SETTINGS_RATE_MAX,
  ADMIN_SETTINGS_RATE_MIN,
  ADMIN_SETTINGS_REASON_MAX,
  type AdminPlatformSettings,
  type AdminSettingsUpdateRequest,
} from "@/lib/contracts";

/** The settings an operator may change, in the order the form lists them. The form field names are the wire names. */
export const SETTINGS_SETTING_FIELDS = ["defaultCommissionRate", "maxStoresPerSeller", "stripeCommissionNote"] as const;
export type SettingsSettingField = (typeof SETTINGS_SETTING_FIELDS)[number];

/** The form holds text for every field, so an input is never uncontrolled. The reason is not a setting. */
export interface SettingsFormValues {
  defaultCommissionRate: string;
  maxStoresPerSeller: string;
  stripeCommissionNote: string;
  reason: string;
}

export type SettingsFormField = keyof SettingsFormValues;
export type SettingsFormErrors = Partial<Record<SettingsFormField, string>>;

export function formFromSettings(settings: AdminPlatformSettings): SettingsFormValues {
  return {
    defaultCommissionRate: String(settings.defaultCommissionRate),
    maxStoresPerSeller: String(settings.maxStoresPerSeller),
    stripeCommissionNote: settings.stripeCommissionNote ?? "",
    reason: "",
  };
}

const RATE_TEXT = /^\d{1,3}(\.\d+)?$/;
const STORES_TEXT = /^\d{1,4}$/;

/** The rate typed, or null when it is not a number from 0 to 100. Rates are percentages (ID-18). */
export function parseRate(text: string): number | null {
  const trimmed = text.trim();
  if (!RATE_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= ADMIN_SETTINGS_RATE_MIN && value <= ADMIN_SETTINGS_RATE_MAX ? value : null;
}

/** The store limit typed, or null when it is not a whole number in the allowed range. */
export function parseStoreLimit(text: string): number | null {
  const trimmed = text.trim();
  if (!STORES_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= ADMIN_SETTINGS_MAX_STORES_MIN && value <= ADMIN_SETTINGS_MAX_STORES_MAX ? value : null;
}

/** A blank note clears it, as the backend does. */
function noteOf(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The same rules the backend enforces. The reason is required in the console (the contract leaves it optional). */
export function validateSettingsForm(values: SettingsFormValues): SettingsFormErrors {
  const errors: SettingsFormErrors = {};

  if (values.defaultCommissionRate.trim() === "") errors.defaultCommissionRate = "Enter a commission rate.";
  else if (parseRate(values.defaultCommissionRate) === null) {
    errors.defaultCommissionRate = "Enter a percentage from " + ADMIN_SETTINGS_RATE_MIN + " to " + ADMIN_SETTINGS_RATE_MAX + ".";
  }

  if (values.maxStoresPerSeller.trim() === "") errors.maxStoresPerSeller = "Enter a store limit.";
  else if (parseStoreLimit(values.maxStoresPerSeller) === null) {
    errors.maxStoresPerSeller = "Enter a whole number from " + ADMIN_SETTINGS_MAX_STORES_MIN + " to " + ADMIN_SETTINGS_MAX_STORES_MAX + ".";
  }

  if (values.stripeCommissionNote.trim().length > ADMIN_SETTINGS_NOTE_MAX) {
    errors.stripeCommissionNote = "The note can be at most " + ADMIN_SETTINGS_NOTE_MAX + " characters.";
  }

  const reason = values.reason.trim();
  if (reason === "") errors.reason = "Enter a reason for the change.";
  else if (reason.length > ADMIN_SETTINGS_REASON_MAX) errors.reason = "The reason can be at most " + ADMIN_SETTINGS_REASON_MAX + " characters.";
  return errors;
}

/**
 * The settings whose value in the form differs from the settings as loaded, in form order. A value that cannot be read
 * counts as changed, so validation reports it instead of the form saying nothing changed.
 */
export function changedSettingFields(values: SettingsFormValues, original: AdminPlatformSettings): SettingsSettingField[] {
  const changed: SettingsSettingField[] = [];
  const rate = parseRate(values.defaultCommissionRate);
  if (rate === null || rate !== original.defaultCommissionRate) changed.push("defaultCommissionRate");
  const stores = parseStoreLimit(values.maxStoresPerSeller);
  if (stores === null || stores !== original.maxStoresPerSeller) changed.push("maxStoresPerSeller");
  if (noteOf(values.stripeCommissionNote) !== original.stripeCommissionNote) changed.push("stripeCommissionNote");
  return changed;
}

/**
 * The update body: only the settings that differ from the settings as loaded, and the reason. Call it with values that
 * passed validateSettingsForm. The body has no revision: the backend reads the revision itself and refuses a clash (409).
 */
export function toUpdateRequest(values: SettingsFormValues, original: AdminPlatformSettings): AdminSettingsUpdateRequest {
  const request: AdminSettingsUpdateRequest = {};
  const rate = parseRate(values.defaultCommissionRate);
  if (rate !== null && rate !== original.defaultCommissionRate) request.defaultCommissionRate = rate;
  const stores = parseStoreLimit(values.maxStoresPerSeller);
  if (stores !== null && stores !== original.maxStoresPerSeller) request.maxStoresPerSeller = stores;
  const note = noteOf(values.stripeCommissionNote);
  if (note !== original.stripeCommissionNote) request.stripeCommissionNote = note;
  const reason = values.reason.trim();
  if (reason !== "") request.reason = reason;
  return request;
}

/** Maps the backend's validation issues onto the form fields. Issues about anything else are dropped. */
export function issuesToErrors(issues: Array<{ path: string; message: string }>): SettingsFormErrors {
  const errors: SettingsFormErrors = {};
  for (const issue of issues) {
    if (issue.path === "defaultCommissionRate" || issue.path === "maxStoresPerSeller" || issue.path === "stripeCommissionNote" || issue.path === "reason") {
      errors[issue.path] = issue.message.charAt(0).toUpperCase() + issue.message.slice(1) + (issue.message.endsWith(".") ? "" : ".");
    }
  }
  return errors;
}
