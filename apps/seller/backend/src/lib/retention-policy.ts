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
  // Sprint 7: the models arrive with the tickets and the contact inbox. Only the periods are fixed here.
  closedTickets: 730,
  contactMessages: 365,
} as const;

export const PURGEABLE_TARGETS = ['notification_outbox', 'sync_outbox', 'stock_movements', 'product_trash'] as const;
export type PurgeableTarget = (typeof PURGEABLE_TARGETS)[number];

/** The most rows one run removes per target; `more: true` in the answer says the next run has more to do. */
export const RETENTION_BATCH = 500;

/** Collections that are never purged. Listed for the guard test and the runbook; nothing reads this to purge. */
export const NEVER_PURGED = ['commissionEntries', 'audit-log', 'subscriptionPayments'] as const;

export const DAY_MS = 86_400_000;
export const cutoffFor = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);
