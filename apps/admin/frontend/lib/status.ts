export type Tone = "success" | "warning" | "danger" | "neutral";

export const STORE_STATUS_VALUES = ["pending", "active", "suspended", "archived"] as const;
export type StoreStatusValue = (typeof STORE_STATUS_VALUES)[number];

/** The one status-to-tone map. Sync and other statuses are added here as their pages arrive. */
export const STATUS_TONES: Record<string, Tone> = {
  active: "success",
  pending: "warning",
  suspended: "danger",
  archived: "neutral",
  live: "success",
  takedown: "danger",
  sent: "success",
  settled: "success",
  dead: "danger",
  // Sprint 4 EP-05.US03: payouts. pending_settle is a payout a request died on: it needs the operator.
  paid: "success",
  pending_settle: "warning",
  voided: "neutral",
  failed: "danger",
};

export function toneOf(status: string): Tone {
  return STATUS_TONES[status] ?? "neutral";
}

export function statusLabel(status: string): string {
  return status === "" ? "" : status.charAt(0).toUpperCase() + status.slice(1);
}
