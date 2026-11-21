import { z } from 'zod';

/**
 * Wire shapes of the admin console's platform settings endpoints (apps/admin-portal): GET and PATCH
 * /api/admin/settings. The settings are one document (the platformSettings global), so there is no id on the wire.
 * Rates are percentages (ID-18). The limits are the single definition: the console form and the backend both enforce
 * them. The writable fields are the policy matrix's ADMIN_PLATFORM_SETTINGS_WRITABLE_FIELDS; settingsRevision is
 * read-only and is advanced by the server.
 */

export const ADMIN_SETTINGS_RATE_MIN = 0;
export const ADMIN_SETTINGS_RATE_MAX = 100;
export const ADMIN_SETTINGS_MAX_STORES_MIN = 1;
export const ADMIN_SETTINGS_MAX_STORES_MAX = 1000;
export const ADMIN_SETTINGS_NOTE_MAX = 500;
export const ADMIN_SETTINGS_REASON_MAX = 500;
/** Sprint 6 (D-118): the plan settings' limits. */
export const ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX = 1000;
export const ADMIN_SETTINGS_GRACE_DAYS_MIN = 0;
export const ADMIN_SETTINGS_GRACE_DAYS_MAX = 30;
export const ADMIN_SETTINGS_GRACE_DAYS_DEFAULT = 7;
export const ADMIN_SETTINGS_TRIAL_DAYS_MIN = 0;
export const ADMIN_SETTINGS_TRIAL_DAYS_MAX = 60;
export const ADMIN_SETTINGS_TRIAL_DAYS_DEFAULT = 0;
export const ADMIN_SETTINGS_SUPPORT_EMAIL_MAX = 254;
export const ADMIN_SETTINGS_SUPPORT_PHONE_MAX = 30;

/** The fields an operator may change, in the order the console lists them. */
export const ADMIN_SETTINGS_FIELDS = [
  'defaultCommissionRate',
  'maxStoresPerSeller',
  'stripeCommissionNote',
  'storeApprovalRequired',
  // Sprint 6 (D-116, D-118).
  'codCommissionPercent',
  'paymentInstructions',
  'graceDays',
  'trialDays',
  'supportEmail',
  'supportPhone',
] as const;
export type AdminSettingsField = (typeof ADMIN_SETTINGS_FIELDS)[number];

const isoDate = z.string().datetime({ offset: true });

const rateSchema = z
  .number()
  .min(ADMIN_SETTINGS_RATE_MIN, 'The commission rate cannot be negative.')
  .max(ADMIN_SETTINGS_RATE_MAX, 'The commission rate can be at most ' + ADMIN_SETTINGS_RATE_MAX + '.');

const maxStoresSchema = z
  .number()
  .int('The store limit must be a whole number.')
  .min(ADMIN_SETTINGS_MAX_STORES_MIN, 'The store limit must be at least ' + ADMIN_SETTINGS_MAX_STORES_MIN + '.')
  .max(ADMIN_SETTINGS_MAX_STORES_MAX, 'The store limit can be at most ' + ADMIN_SETTINGS_MAX_STORES_MAX + '.');

const noteSchema = z
  .string()
  .trim()
  .max(ADMIN_SETTINGS_NOTE_MAX, 'The note can be at most ' + ADMIN_SETTINGS_NOTE_MAX + ' characters.')
  .nullable();

const graceDaysSchema = z
  .number()
  .int('The grace period must be a whole number of days.')
  .min(ADMIN_SETTINGS_GRACE_DAYS_MIN, 'The grace period cannot be negative.')
  .max(ADMIN_SETTINGS_GRACE_DAYS_MAX, 'The grace period can be at most ' + ADMIN_SETTINGS_GRACE_DAYS_MAX + ' days.');

const trialDaysSchema = z
  .number()
  .int('The trial must be a whole number of days.')
  .min(ADMIN_SETTINGS_TRIAL_DAYS_MIN, 'The trial cannot be negative.')
  .max(ADMIN_SETTINGS_TRIAL_DAYS_MAX, 'The trial can be at most ' + ADMIN_SETTINGS_TRIAL_DAYS_MAX + ' days.');

/** Plain text; blank clears it (null). Shown to sellers and escaped on output. */
const paymentInstructionsSchema = z
  .string()
  .trim()
  .max(ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX, 'The payment instructions can be at most ' + ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX + ' characters.')
  .nullable();

const supportEmailSchema = z
  .string()
  .trim()
  .max(ADMIN_SETTINGS_SUPPORT_EMAIL_MAX, 'The support email can be at most ' + ADMIN_SETTINGS_SUPPORT_EMAIL_MAX + ' characters.')
  .refine((value) => value === '' || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value), 'Enter a valid email address.')
  .nullable();

const supportPhoneSchema = z
  .string()
  .trim()
  .max(ADMIN_SETTINGS_SUPPORT_PHONE_MAX, 'The support phone can be at most ' + ADMIN_SETTINGS_SUPPORT_PHONE_MAX + ' characters.')
  .refine((value) => value === '' || /^[0-9+\-() ]+$/.test(value), 'Use digits, spaces, + - and brackets only.')
  .nullable();

const reasonSchema = z
  .string()
  .trim()
  .min(1, 'Enter a reason.')
  .max(ADMIN_SETTINGS_REASON_MAX, 'The reason can be at most ' + ADMIN_SETTINGS_REASON_MAX + ' characters.');

export const adminPlatformSettingsSchema = z.object({
  /** Percentage applied to a store that inherits the platform rate. */
  defaultCommissionRate: z.number().min(ADMIN_SETTINGS_RATE_MIN).max(ADMIN_SETTINGS_RATE_MAX),
  maxStoresPerSeller: z.number().int().min(ADMIN_SETTINGS_MAX_STORES_MIN),
  stripeCommissionNote: z.string().nullable(),
  /** Sprint 4 D-094/D-095: go-live waits for an admin when true. An older backend sends none: false. */
  storeApprovalRequired: z.boolean().default(false),
  /** Sprint 6 D-116: the commission percent on cash-on-delivery orders (default 0). An older backend sends none: 0. */
  codCommissionPercent: z.number().min(ADMIN_SETTINGS_RATE_MIN).max(ADMIN_SETTINGS_RATE_MAX).default(0),
  /** Sprint 6 D-118: how a seller pays a subscription by hand; null when none is set. Escaped on output. */
  paymentInstructions: z.string().max(ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX).nullable().default(null),
  graceDays: z.number().int().min(ADMIN_SETTINGS_GRACE_DAYS_MIN).max(ADMIN_SETTINGS_GRACE_DAYS_MAX).default(ADMIN_SETTINGS_GRACE_DAYS_DEFAULT),
  trialDays: z.number().int().min(ADMIN_SETTINGS_TRIAL_DAYS_MIN).max(ADMIN_SETTINGS_TRIAL_DAYS_MAX).default(ADMIN_SETTINGS_TRIAL_DAYS_DEFAULT),
  supportEmail: z.string().max(ADMIN_SETTINGS_SUPPORT_EMAIL_MAX).nullable().default(null),
  supportPhone: z.string().max(ADMIN_SETTINGS_SUPPORT_PHONE_MAX).nullable().default(null),
  /** Advanced by the server on every change; never writable. */
  settingsRevision: z.number().int().min(0),
  updatedAt: isoDate.nullable(),
});

export const adminSettingsResponseSchema = z.object({ settings: adminPlatformSettingsSchema });

/**
 * Update. Only the settings sent change, and at least one must be sent. The reason is optional and is kept in the
 * audit entry only; it is not a setting.
 */
export const adminSettingsUpdateRequestSchema = z
  .object({
    defaultCommissionRate: rateSchema.optional(),
    maxStoresPerSeller: maxStoresSchema.optional(),
    stripeCommissionNote: noteSchema.optional(),
    storeApprovalRequired: z.boolean({ error: 'Choose yes or no.' }).optional(),
    codCommissionPercent: rateSchema.optional(),
    paymentInstructions: paymentInstructionsSchema.optional(),
    graceDays: graceDaysSchema.optional(),
    trialDays: trialDaysSchema.optional(),
    supportEmail: supportEmailSchema.optional(),
    supportPhone: supportPhoneSchema.optional(),
    reason: reasonSchema.optional(),
  })
  .strict()
  .refine((value) => ADMIN_SETTINGS_FIELDS.some((field) => value[field] !== undefined), { message: 'Change at least one setting.' });

/** The sync event queued for the seller when a synced setting changed; null when nothing needed to be sent. */
export const adminSettingsQueuedSchema = z.object({
  eventId: z.string().min(1),
  revision: z.number().int().min(1),
});

export const adminSettingsUpdateResponseSchema = z.object({
  settings: adminPlatformSettingsSchema,
  queued: adminSettingsQueuedSchema.nullable(),
});

export type AdminPlatformSettings = z.infer<typeof adminPlatformSettingsSchema>;
export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;
export type AdminSettingsUpdateRequest = z.infer<typeof adminSettingsUpdateRequestSchema>;
export type AdminSettingsUpdateResponse = z.infer<typeof adminSettingsUpdateResponseSchema>;
