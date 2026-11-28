import type { AdminSyncEvent, FailedEmailRow, RetentionRunResponse } from "@/lib/contracts";

/**
 * Sprint 6 (S6-B7): the retry buttons of the Sync page, the failed-email section and the Retention page. Pure helpers. The server enforces the
 * capability (sync.manage, and settings.write for the retention), the cap of 100 and the compare-and-set; these only follow.
 */

export const RETRY_MAX = 100;

/** The ids a "retry this page" press sends: dead events only, at most 100. */
export function retryableEventIds(events: readonly Pick<AdminSyncEvent, "id" | "status">[]): string[] {
  return events.filter((event) => event.status === "dead").map((event) => event.id).slice(0, RETRY_MAX);
}

export function retryButtonText(count: number): string {
  return count === 0 ? "Nothing to retry" : count === 1 ? "Retry this event" : "Retry " + count + " events";
}

export function retryResultText(result: { requested: number; retried: number; skipped: number }, noun = "event"): string {
  const plural = (n: number) => n + " " + noun + (n === 1 ? "" : "s");
  if (result.retried === 0) return "Nothing was retried: " + plural(result.skipped) + " had already moved.";
  return plural(result.retried) + " back in the queue" + (result.skipped > 0 ? "; " + result.skipped + " had already moved." : ".");
}

export const failedEmailIds = (rows: readonly Pick<FailedEmailRow, "id">[]): string[] => rows.map((row) => row.id).slice(0, RETRY_MAX);

/** "order_placed_customer" -> "Order placed customer". */
export function kindLabel(kind: string): string {
  const text = kind.replace(/_/g, " ").trim();
  return text === "" ? "Email" : text.charAt(0).toUpperCase() + text.slice(1);
}

export const RETENTION_LABELS: Record<RetentionRunResponse["targets"][number]["key"], string> = {
  notification_outbox: "Sent emails",
  sync_outbox: "Sent sync events",
  stock_movements: "Stock history",
  product_trash: "Products in trash",
  contact_messages: "Closed contact messages",
  closed_tickets: "Closed tickets",
  mobile_devices: "Signed-out phones",
};

export interface RetentionLine {
  key: string;
  label: string;
  text: string;
}

/** One line per target: what is past its period, and after an apply what was removed (and whether the next run has more). */
export function retentionLines(run: RetentionRunResponse): RetentionLine[] {
  return run.targets.map((t) => ({
    key: t.key,
    label: RETENTION_LABELS[t.key] + " older than " + t.days + " days",
    text: run.dryRun ? t.eligible + " would be removed" + (t.more ? " (more than one run can take)" : "") : t.purged + " removed" + (t.more ? ", more are left for the next run" : ""),
  }));
}

export const retentionTotal = (run: RetentionRunResponse): number => run.targets.reduce((sum, t) => sum + (run.dryRun ? t.eligible : t.purged), 0);

/** Apply is offered only after a dry run that found something, and always asks first. */
export const canApply = (dry: RetentionRunResponse | null): boolean => dry !== null && dry.dryRun && retentionTotal(dry) > 0;
