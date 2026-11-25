import {
  ADMIN_SETTINGS_GRACE_DAYS_MAX,
  ADMIN_SETTINGS_GRACE_DAYS_MIN,
  ADMIN_SETTINGS_MAX_STORES_MAX,
  ADMIN_SETTINGS_MAX_STORES_MIN,
  ADMIN_SETTINGS_NOTE_MAX,
  ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX,
  ADMIN_SETTINGS_RATE_MAX,
  ADMIN_SETTINGS_RATE_MIN,
  ADMIN_SETTINGS_REASON_MAX,
  ADMIN_SETTINGS_REFERRAL_CAP_MAX,
  ADMIN_SETTINGS_REFERRAL_CAP_MIN,
  ADMIN_SETTINGS_REFERRAL_MONTHS_MAX,
  ADMIN_SETTINGS_REFERRAL_MONTHS_MIN,
  ADMIN_SETTINGS_SUPPORT_EMAIL_MAX,
  ADMIN_SETTINGS_SUPPORT_PHONE_MAX,
  ADMIN_SETTINGS_TRIAL_DAYS_MAX,
  ADMIN_SETTINGS_TRIAL_DAYS_MIN,
  type AdminPlatformSettings,
  type AdminSettingsUpdateRequest,
} from "@/lib/contracts";

/** The settings an operator may change, in the order the form lists them. The form field names are the wire names. */
export const SETTINGS_SETTING_FIELDS = [
  "defaultCommissionRate",
  "maxStoresPerSeller",
  "stripeCommissionNote",
  // Sprint 6 (D-116, D-118).
  "codCommissionPercent",
  "paymentInstructions",
  "graceDays",
  "trialDays",
  "supportEmail",
  "supportPhone",
  // Sprint 8 (S8-B5).
  "referralRewardMonths",
  "referralMonthlyCap",
] as const;
export type SettingsSettingField = (typeof SETTINGS_SETTING_FIELDS)[number];

/** The form holds text for every field, so an input is never uncontrolled. The reason is not a setting. */
export interface SettingsFormValues {
  defaultCommissionRate: string;
  maxStoresPerSeller: string;
  stripeCommissionNote: string;
  /** Sprint 6 D-116: percent on cash-on-delivery orders (0 = none). */
  codCommissionPercent: string;
  /** Sprint 6 D-118: plain text shown to sellers for manual subscription payments. Blank clears it. */
  paymentInstructions: string;
  graceDays: string;
  trialDays: string;
  supportEmail: string;
  supportPhone: string;
  /** Sprint 8 (S8-B5): free months per rewarded referral (0 turns referrals off) and the rewards a referrer can earn a month. */
  referralRewardMonths: string;
  referralMonthlyCap: string;
  reason: string;
}

export type SettingsFormField = keyof SettingsFormValues;
export type SettingsFormErrors = Partial<Record<SettingsFormField, string>>;

export function formFromSettings(settings: AdminPlatformSettings): SettingsFormValues {
  return {
    defaultCommissionRate: String(settings.defaultCommissionRate),
    maxStoresPerSeller: String(settings.maxStoresPerSeller),
    stripeCommissionNote: settings.stripeCommissionNote ?? "",
    codCommissionPercent: String(settings.codCommissionPercent ?? 0),
    paymentInstructions: settings.paymentInstructions ?? "",
    graceDays: String(settings.graceDays ?? 7),
    trialDays: String(settings.trialDays ?? 0),
    supportEmail: settings.supportEmail ?? "",
    supportPhone: settings.supportPhone ?? "",
    referralRewardMonths: String(settings.referralRewardMonths ?? 1),
    referralMonthlyCap: String(settings.referralMonthlyCap ?? 5),
    reason: "",
  };
}

const RATE_TEXT = /^\d{1,3}(\.\d+)?$/;
const STORES_TEXT = /^\d{1,4}$/;
const DAYS_TEXT = /^\d{1,2}$/;
const COUNT_TEXT = /^\d{1,3}$/;
const EMAIL_TEXT = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PHONE_TEXT = /^[0-9+\-() ]+$/;

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

/** Whole days from min to max, or null. Used for the grace period and the trial. */
export function parseDays(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!DAYS_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** A whole number from min to max, or null. Used for the referral settings. */
export function parseCount(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!COUNT_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** A blank note clears it, as the backend does. */
function noteOf(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The same rules the backend enforces, the required reason included. */
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

  if (values.codCommissionPercent.trim() === "") errors.codCommissionPercent = "Enter the cash on delivery percent (0 for none).";
  else if (parseRate(values.codCommissionPercent) === null) {
    errors.codCommissionPercent = "Enter a percentage from " + ADMIN_SETTINGS_RATE_MIN + " to " + ADMIN_SETTINGS_RATE_MAX + ".";
  }

  if (values.paymentInstructions.trim().length > ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX) {
    errors.paymentInstructions = "The payment instructions can be at most " + ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX + " characters.";
  }

  if (values.graceDays.trim() === "") errors.graceDays = "Enter the grace period in days (0 for none).";
  else if (parseDays(values.graceDays, ADMIN_SETTINGS_GRACE_DAYS_MIN, ADMIN_SETTINGS_GRACE_DAYS_MAX) === null) {
    errors.graceDays = "Enter a whole number of days from " + ADMIN_SETTINGS_GRACE_DAYS_MIN + " to " + ADMIN_SETTINGS_GRACE_DAYS_MAX + ".";
  }

  if (values.trialDays.trim() === "") errors.trialDays = "Enter the trial in days (0 for none).";
  else if (parseDays(values.trialDays, ADMIN_SETTINGS_TRIAL_DAYS_MIN, ADMIN_SETTINGS_TRIAL_DAYS_MAX) === null) {
    errors.trialDays = "Enter a whole number of days from " + ADMIN_SETTINGS_TRIAL_DAYS_MIN + " to " + ADMIN_SETTINGS_TRIAL_DAYS_MAX + ".";
  }

  const email = values.supportEmail.trim();
  if (email.length > ADMIN_SETTINGS_SUPPORT_EMAIL_MAX || (email !== "" && !EMAIL_TEXT.test(email))) errors.supportEmail = "Enter a valid email address.";

  const phone = values.supportPhone.trim();
  if (phone.length > ADMIN_SETTINGS_SUPPORT_PHONE_MAX || (phone !== "" && !PHONE_TEXT.test(phone))) {
    errors.supportPhone = "Use digits, spaces, + - and brackets only, at most " + ADMIN_SETTINGS_SUPPORT_PHONE_MAX + " characters.";
  }

  if (parseCount(values.referralRewardMonths, ADMIN_SETTINGS_REFERRAL_MONTHS_MIN, ADMIN_SETTINGS_REFERRAL_MONTHS_MAX) === null) {
    errors.referralRewardMonths = "Enter a whole number of months from " + ADMIN_SETTINGS_REFERRAL_MONTHS_MIN + " to " + ADMIN_SETTINGS_REFERRAL_MONTHS_MAX + " (0 turns referrals off).";
  }
  if (parseCount(values.referralMonthlyCap, ADMIN_SETTINGS_REFERRAL_CAP_MIN, ADMIN_SETTINGS_REFERRAL_CAP_MAX) === null) {
    errors.referralMonthlyCap = "Enter a whole number from " + ADMIN_SETTINGS_REFERRAL_CAP_MIN + " to " + ADMIN_SETTINGS_REFERRAL_CAP_MAX + ".";
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
  const cod = parseRate(values.codCommissionPercent);
  if (cod === null || cod !== (original.codCommissionPercent ?? 0)) changed.push("codCommissionPercent");
  if (noteOf(values.paymentInstructions) !== (original.paymentInstructions ?? null)) changed.push("paymentInstructions");
  const grace = parseDays(values.graceDays, ADMIN_SETTINGS_GRACE_DAYS_MIN, ADMIN_SETTINGS_GRACE_DAYS_MAX);
  if (grace === null || grace !== (original.graceDays ?? 7)) changed.push("graceDays");
  const trial = parseDays(values.trialDays, ADMIN_SETTINGS_TRIAL_DAYS_MIN, ADMIN_SETTINGS_TRIAL_DAYS_MAX);
  if (trial === null || trial !== (original.trialDays ?? 0)) changed.push("trialDays");
  if (noteOf(values.supportEmail) !== (original.supportEmail ?? null)) changed.push("supportEmail");
  if (noteOf(values.supportPhone) !== (original.supportPhone ?? null)) changed.push("supportPhone");
  const months = parseCount(values.referralRewardMonths, ADMIN_SETTINGS_REFERRAL_MONTHS_MIN, ADMIN_SETTINGS_REFERRAL_MONTHS_MAX);
  if (months === null || months !== (original.referralRewardMonths ?? 1)) changed.push("referralRewardMonths");
  const cap = parseCount(values.referralMonthlyCap, ADMIN_SETTINGS_REFERRAL_CAP_MIN, ADMIN_SETTINGS_REFERRAL_CAP_MAX);
  if (cap === null || cap !== (original.referralMonthlyCap ?? 5)) changed.push("referralMonthlyCap");
  return changed;
}

/**
 * The update body: only the settings that differ from the settings as loaded, and the reason. Call it with values that
 * passed validateSettingsForm. The body has no revision: the backend reads the revision itself and refuses a clash (409).
 */
export function toUpdateRequest(values: SettingsFormValues, original: AdminPlatformSettings): AdminSettingsUpdateRequest {
  // The reason is required by the contract; the form is validated before this is called.
  const request = {} as AdminSettingsUpdateRequest;
  const rate = parseRate(values.defaultCommissionRate);
  if (rate !== null && rate !== original.defaultCommissionRate) request.defaultCommissionRate = rate;
  const stores = parseStoreLimit(values.maxStoresPerSeller);
  if (stores !== null && stores !== original.maxStoresPerSeller) request.maxStoresPerSeller = stores;
  const note = noteOf(values.stripeCommissionNote);
  if (note !== original.stripeCommissionNote) request.stripeCommissionNote = note;
  const cod = parseRate(values.codCommissionPercent);
  if (cod !== null && cod !== (original.codCommissionPercent ?? 0)) request.codCommissionPercent = cod;
  const instructions = noteOf(values.paymentInstructions);
  if (instructions !== (original.paymentInstructions ?? null)) request.paymentInstructions = instructions;
  const grace = parseDays(values.graceDays, ADMIN_SETTINGS_GRACE_DAYS_MIN, ADMIN_SETTINGS_GRACE_DAYS_MAX);
  if (grace !== null && grace !== (original.graceDays ?? 7)) request.graceDays = grace;
  const trial = parseDays(values.trialDays, ADMIN_SETTINGS_TRIAL_DAYS_MIN, ADMIN_SETTINGS_TRIAL_DAYS_MAX);
  if (trial !== null && trial !== (original.trialDays ?? 0)) request.trialDays = trial;
  const email = noteOf(values.supportEmail);
  if (email !== (original.supportEmail ?? null)) request.supportEmail = email;
  const phone = noteOf(values.supportPhone);
  if (phone !== (original.supportPhone ?? null)) request.supportPhone = phone;
  const months = parseCount(values.referralRewardMonths, ADMIN_SETTINGS_REFERRAL_MONTHS_MIN, ADMIN_SETTINGS_REFERRAL_MONTHS_MAX);
  if (months !== null && months !== (original.referralRewardMonths ?? 1)) request.referralRewardMonths = months;
  const cap = parseCount(values.referralMonthlyCap, ADMIN_SETTINGS_REFERRAL_CAP_MIN, ADMIN_SETTINGS_REFERRAL_CAP_MAX);
  if (cap !== null && cap !== (original.referralMonthlyCap ?? 5)) request.referralMonthlyCap = cap;
  const reason = values.reason.trim();
  if (reason !== "") request.reason = reason;
  return request;
}

/** Maps the backend's validation issues onto the form fields. Issues about anything else are dropped. */
export function issuesToErrors(issues: Array<{ path: string; message: string }>): SettingsFormErrors {
  const errors: SettingsFormErrors = {};
  for (const issue of issues) {
    if ((SETTINGS_SETTING_FIELDS as readonly string[]).includes(issue.path) || issue.path === "reason") {
      errors[issue.path as SettingsFormField] = issue.message.charAt(0).toUpperCase() + issue.message.slice(1) + (issue.message.endsWith(".") ? "" : ".");
    }
  }
  return errors;
}
