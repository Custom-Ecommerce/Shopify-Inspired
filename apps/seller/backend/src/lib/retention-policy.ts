/**
 * Sprint 6 EP-29 (S6-B7, D-118): EVERY retention period of the platform, in one place. Days, counted back from the server's clock (never a request's).
 *
 * NEVER purged, by design: the commission ledger (CommissionEntry, append-only, D-090), the audit log, and subscription payments. They are not in
 * PURGEABLE_TARGETS and the purge code does not reference them (a guard test reads the source).
 */

export const RETENTION_DAYS = {
  notificationOutboxSent: 90,
  syncOutboxSent: 30,
  stockMovements: 365,
  productTrash: 365,
  // Sprint 7 (S7-B4): closed tickets and closed contact messages, counted from their last change. Open and answered ones are never purged.
  closedTickets: 730,
  contactMessages: 365,
  // Sprint 9 (EP-31.US01.T09): signed-out phones (both apps), counted from the day they were revoked. A phone that is still signed in is never purged.
  revokedMobileDevices: 90,
} as const;

export const PURGEABLE_TARGETS = ['notification_outbox', 'sync_outbox', 'stock_movements', 'product_trash', 'contact_messages', 'closed_tickets', 'mobile_devices'] as const;
export type PurgeableTarget = (typeof PURGEABLE_TARGETS)[number];

/** The most rows one run removes per target; `more: true` in the answer says the next run has more to do. */
export const RETENTION_BATCH = 500;

/** Collections that are never purged. Listed for the guard test and the runbook; nothing reads this to purge. */
export const NEVER_PURGED = ['commissionEntries', 'audit-log', 'subscriptionPayments'] as const;

export const DAY_MS = 86_400_000;
export const cutoffFor = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

/**
 * Sprint 8 (S8-B6, D-118): collections MongoDB empties by itself, with a TTL index on a real date field (declared on the model, planned by
 * scripts/ensure-indexes.mjs). Days. The purge code does not touch them: there is nothing for it to do.
 */
export const TTL_RETENTION_DAYS = {
  dailyStats: 400,
  productDailyStats: 400,
} as const;
