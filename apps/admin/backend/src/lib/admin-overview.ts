import { toLedgerTotals } from '@/lib/admin-commission';
import { STORE_STATUSES, toIso, type Doc, type StoreStatus } from '@/lib/admin-stores';
import { SYNC_STATUSES } from '@/lib/admin-sync';

/**
 * Pure helpers for the admin overview endpoint: the seller window, and the wire shape built from the grouped counts
 * and totals the route reads. No I/O. The window is the same as ADMIN_OVERVIEW_NEW_SELLER_DAYS in @markaz/contracts
 * (admin-overview.ts). Amounts are minor units (ID-18).
 */

export const NEW_SELLER_WINDOW_DAYS = 30;

/** The ledger fields the overview reads, a subset of the fields the admin policy may read (ADMIN_LEDGER_READABLE_FIELDS). */
export const OVERVIEW_LEDGER_FIELDS = ['status', 'orderAmount', 'commissionAmount'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the new-seller window: sellers created at or after this moment are new. */
export function newSellerSince(now: Date): Date {
  return new Date(now.getTime() - NEW_SELLER_WINDOW_DAYS * DAY_MS);
}

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Stores by status from the grouped aggregate. A status with no stores is zero; a group with any other status (or none)
 * is ignored, so the total is the sum of the four known statuses and the console never shows a status it cannot name.
 */
export function toStoreCounts(groups: unknown): { total: number; byStatus: Record<StoreStatus, number> } {
  const byStatus: Record<StoreStatus, number> = { pending: 0, active: 0, suspended: 0, archived: 0 };
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (typeof group !== 'object' || group === null) continue;
      const row = group as Doc;
      const key = row._id;
      if (typeof key !== 'string' || !(STORE_STATUSES as readonly string[]).includes(key)) continue;
      byStatus[key as StoreStatus] = whole(row.count);
    }
  }
  const total = STORE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
  return { total, byStatus };
}

/** Seller accounts: the total, and how many were created in the window (never more than the total). */
export function toSellerCounts(total: unknown, recent: unknown): { total: number; newInWindow: number; windowDays: number } {
  const all = whole(total);
  return { total: all, newInWindow: Math.min(whole(recent), all), windowDays: NEW_SELLER_WINDOW_DAYS };
}

/**
 * The outbox health: counts in the order of SYNC_STATUSES (pending, sent, dead), the creation time of the oldest
 * pending event, and the send time of the last sent one. Only times and counts: the event payload is never read.
 */
export function toOutboxHealth(counts: readonly unknown[], oldestPending: Doc | null | undefined, lastSent: Doc | null | undefined) {
  const byStatus = { pending: 0, sent: 0, dead: 0 };
  SYNC_STATUSES.forEach((status, index) => {
    byStatus[status] = whole(counts[index]);
  });
  return {
    counts: byStatus,
    oldestPendingAt: toIso(oldestPending?.createdAt),
    lastSentAt: toIso(lastSent?.sentAt),
  };
}

export interface OverviewParts {
  storeGroups: unknown;
  sellerTotal: unknown;
  sellerRecent: unknown;
  ledgerGroups: unknown;
  /** Outbox counts in the order of SYNC_STATUSES. */
  outboxCounts: readonly unknown[];
  oldestPending: Doc | null | undefined;
  lastSent: Doc | null | undefined;
}

/** The overview as the console reads it. */
export function toOverview(parts: OverviewParts, now: Date) {
  return {
    stores: toStoreCounts(parts.storeGroups),
    sellers: toSellerCounts(parts.sellerTotal, parts.sellerRecent),
    ledger: toLedgerTotals(parts.ledgerGroups),
    outbox: toOutboxHealth(parts.outboxCounts, parts.oldestPending, parts.lastSent),
    generatedAt: now.toISOString(),
  };
}

export type OverviewRow = ReturnType<typeof toOverview>;
