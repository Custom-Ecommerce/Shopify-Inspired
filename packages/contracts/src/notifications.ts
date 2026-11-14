import { z } from 'zod';

/*
 * Sprint 4 EP-07.US03: the seller's in-app alerts (the dashboard bell) and the email switches.
 */

export const SELLER_ALERT_KINDS = ['new_order', 'low_stock', 'out_of_stock'] as const;
export type SellerAlertKind = (typeof SELLER_ALERT_KINDS)[number];

/** Default and largest page of GET /api/alerts. */
export const SELLER_ALERT_PAGE_DEFAULT = 20;
export const SELLER_ALERT_PAGE_MAX = 50;
/** How many alerts the bell shows in its short list. */
export const SELLER_ALERT_BELL_LIMIT = 5;
/** How often the dashboard asks for the unread count. */
export const SELLER_ALERT_POLL_MS = 60_000;

/** One alert as the dashboard receives it. link is a dashboard path relative to the store (e.g. /orders/<id>). */
export const sellerAlertSchema = z.object({
  id: z.string(),
  kind: z.enum(SELLER_ALERT_KINDS),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SellerAlertWire = z.output<typeof sellerAlertSchema>;

export const sellerAlertListResponseSchema = z.object({
  docs: z.array(sellerAlertSchema),
  totalDocs: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  unread: z.number().int().nonnegative(),
});
export type SellerAlertListResponse = z.output<typeof sellerAlertListResponseSchema>;

export const sellerAlertUnreadResponseSchema = z.object({ unread: z.number().int().nonnegative() });
export type SellerAlertUnreadResponse = z.output<typeof sellerAlertUnreadResponseSchema>;

/** POST /api/alerts/read-all answers how many were marked. */
export const sellerAlertReadAllResponseSchema = z.object({ marked: z.number().int().nonnegative(), unread: z.number().int().nonnegative() });
export type SellerAlertReadAllResponse = z.output<typeof sellerAlertReadAllResponseSchema>;

/** The seller's email switches (EP-07.US03.T03). In-app alerts cannot be switched off. Missing means on. */
export const notificationPrefsSchema = z.object({
  emailNewOrder: z.boolean(),
  emailLowStock: z.boolean(),
});
export type NotificationPrefs = z.output<typeof notificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { emailNewOrder: true, emailLowStock: true };

/** PATCH /api/users/me/notification-prefs: one or both switches. Unknown keys are refused. */
export const notificationPrefsUpdateSchema = z
  .object({
    emailNewOrder: z.boolean().optional(),
    emailLowStock: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one switch is required' });
export type NotificationPrefsUpdate = z.output<typeof notificationPrefsUpdateSchema>;

/** A stored prefs value read leniently: anything that is not false is on. */
export function readNotificationPrefs(stored: unknown): NotificationPrefs {
  const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  return { emailNewOrder: value.emailNewOrder !== false, emailLowStock: value.emailLowStock !== false };
}
