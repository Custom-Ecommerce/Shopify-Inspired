import type { AdminOverview } from "@/lib/contracts";
import { formatRelative } from "@/lib/format";
import { statusLabel, STORE_STATUS_VALUES, type StoreStatusValue, type Tone } from "@/lib/status";
import { listStateToQuery } from "@/lib/stores";
import { SYNC_STATUS_LABELS, SYNC_STATUS_VALUES, syncHealth, syncStateToQuery, type SyncStatusValue } from "@/lib/sync";

export type OverviewTileKey = "stores" | "sellers" | "sync";

export interface OverviewTile {
  key: OverviewTileKey;
  title: string;
  href: string;
  /** The headline: a count, an amount, or the sync health. */
  value: string;
  hint: string;
  /** A call for attention, or null when nothing needs it. */
  badge: { label: string; tone: Tone } | null;
}

function withQuery(path: string, query: string): string {
  return query === "" ? path : path + "?" + query;
}

/** The store list filtered to one status. */
export function storeStatusHref(status: StoreStatusValue): string {
  return withQuery("/stores", listStateToQuery({ page: 1, q: "", status }));
}

/** The sync page on one status. Dead letters are the page's default, so they have no query. */
export function syncStatusHref(status: SyncStatusValue): string {
  return withQuery("/sync", syncStateToQuery({ page: 1, status }));
}

/** The three headline tiles, in the order the page shows them. SB-12: the commission tile is gone, it read the old ledger. */
export function overviewTiles(overview: AdminOverview, now: Date = new Date()): OverviewTile[] {
  const { stores, sellers, outbox } = overview;
  const health = syncHealth(outbox.counts, outbox.oldestPendingAt, now);
  return [
    {
      key: "stores",
      title: "Stores",
      href: "/stores",
      value: String(stores.total),
      hint: stores.byStatus.active + " active, " + stores.byStatus.pending + " pending",
      badge: stores.byStatus.suspended > 0 ? { label: stores.byStatus.suspended + " suspended", tone: "warning" } : null,
    },
    {
      key: "sellers",
      title: "Sellers",
      href: "/sellers",
      value: String(sellers.total),
      hint: sellers.newInWindow + " new in the last " + sellers.windowDays + " days",
      badge: null,
    },
    {
      key: "sync",
      title: "Sync health",
      href: "/sync",
      value: health.label,
      hint: health.detail,
      badge: outbox.counts.dead > 0 ? { label: outbox.counts.dead + " dead", tone: "danger" } : null,
    },
  ];
}

export interface OverviewRow {
  status: string;
  label: string;
  /** The count, as text. */
  count: string;
  /** A second figure, or null when the row has none. */
  detail: string | null;
  href: string;
}

/** Stores by status: one row per status, each linking to the store list on that status. */
export function storeRows(overview: AdminOverview): OverviewRow[] {
  return STORE_STATUS_VALUES.map((status) => ({
    status,
    label: statusLabel(status),
    count: String(overview.stores.byStatus[status]),
    detail: null,
    href: storeStatusHref(status),
  }));
}

/** The outbox by status, each linking to the sync page on that status. */
export function outboxRows(overview: AdminOverview): OverviewRow[] {
  return SYNC_STATUS_VALUES.map((status) => ({
    status,
    label: SYNC_STATUS_LABELS[status],
    count: String(overview.outbox.counts[status]),
    detail: null,
    href: syncStatusHref(status),
  }));
}

/** How fresh the numbers are, from the time the backend read them. */
export function updatedLabel(generatedAt: string, now: Date = new Date()): string {
  return "Updated " + formatRelative(generatedAt, now);
}
