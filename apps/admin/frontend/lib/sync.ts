import { formatRelative } from "@/lib/format";
import { readChoice, readPage } from "@/lib/list-state";
import type { Tone } from "@/lib/status";
import { PAGE_SIZE } from "@/lib/stores";

export const SYNC_STATUS_VALUES = ["pending", "sent", "dead"] as const;
export type SyncStatusValue = (typeof SYNC_STATUS_VALUES)[number];

/** The event list shows dead letters first, the same default the backend uses. */
export const DEFAULT_SYNC_STATUS: SyncStatusValue = "dead";

export const SYNC_STATUS_LABELS: Record<SyncStatusValue, string> = {
  pending: "Pending",
  sent: "Sent",
  dead: "Dead letter",
};

export interface SyncListState {
  page: number;
  status: SyncStatusValue;
}

export function parseSyncListState(params: { get(name: string): string | null }): SyncListState {
  return { page: readPage(params), status: readChoice(params, "status", SYNC_STATUS_VALUES, DEFAULT_SYNC_STATUS) };
}

export function syncStateToQuery(state: SyncListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.status !== DEFAULT_SYNC_STATUS) params.set("status", state.status);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

/** The cron drains the outbox every minute, so a pending event older than this has missed several drains. */
export const STALE_PENDING_MS = 5 * 60 * 1000;

export interface SyncHealth {
  tone: Tone;
  label: string;
  detail: string;
}

function plural(count: number, noun: string): string {
  return count + " " + noun + (count === 1 ? "" : "s");
}

/** One summary of the outbox: dead letters need attention, a stale pending event is a backlog, otherwise healthy. */
export function syncHealth(counts: { pending: number; sent: number; dead: number }, oldestPendingAt: string | null, now: Date = new Date()): SyncHealth {
  if (counts.dead > 0) {
    return { tone: "danger", label: "Needs attention", detail: plural(counts.dead, "event") + " could not be delivered and will not be retried." };
  }
  const oldest = oldestPendingAt === null ? Number.NaN : new Date(oldestPendingAt).getTime();
  if (counts.pending > 0 && !Number.isNaN(oldest) && now.getTime() - oldest > STALE_PENDING_MS) {
    return { tone: "warning", label: "Backlog", detail: "The oldest pending event was queued " + formatRelative(oldestPendingAt, now) + "." };
  }
  if (counts.pending > 0) {
    return { tone: "success", label: "Healthy", detail: plural(counts.pending, "event") + " waiting for the next drain." };
  }
  return { tone: "success", label: "Healthy", detail: "Every event has been delivered." };
}
