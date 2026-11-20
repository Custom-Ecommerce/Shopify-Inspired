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

/** The fields an operator may change, in the order the console lists them. */
export const ADMIN_SETTINGS_FIELDS = ['defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote', 'storeApprovalRequired'] as const;
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
