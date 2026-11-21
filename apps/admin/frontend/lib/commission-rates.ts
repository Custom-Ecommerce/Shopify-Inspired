/**
 * Sprint 4 EP-05.US02 (D-089): the wire shapes and checks of the commission rate screens. A rate is a percentage from 0
 * to 100 with at most one decimal; the backend checks it again.
 */

export const RATE_MAX = 100;

/** Sprint 6 D-116: the platform default and a store's own rate are for GATEWAY (card) orders only. Cash on delivery has its own percent. */
export const GATEWAY_ONLY_NOTE = "Applies to gateway (card) orders only. Cash on delivery has its own percent in Settings and no store rate applies to it.";
export const PLATFORM_RATE_DESCRIPTION = "Applies to gateway (card) orders of every store whose rate source is the platform default. Cash on delivery follows the COD percent in Settings.";
export const STORE_RATE_DESCRIPTION = "A store's own rate applies to its gateway (card) orders only, never to cash on delivery.";
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export interface RateHistoryRow {
  id: string;
  scope: "store" | "platform";
  store: { id: string; name: string } | null;
  actor: string;
  oldMode: string | null;
  oldRate: number | null;
  newMode: string | null;
  newRate: number | null;
  reason: string;
  createdAt: string | null;
}

export interface RateHistoryList {
  docs: RateHistoryRow[];
  page: number;
  totalPages: number;
  totalDocs: number;
}

/** Reads what the user typed: "4", "4.5", "4,5". Null when it is not a rate with at most one decimal between 0 and 100. */
export function parseRateInput(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d)?$/.test(clean)) return null;
  const value = Number(clean);
  return value >= 0 && value <= RATE_MAX ? value : null;
}

/** The sentence the confirmation step shows. A null rate means the platform default. */
export function describeRateChange(subject: string, from: number | null, to: number | null, defaultRate: number): string {
  const label = (rate: number | null) => (rate === null ? "the platform default (" + defaultRate + "%)" : rate + "%");
  return subject + ": " + label(from) + " to " + label(to) + ". It applies to gateway (card) orders paid after this change, never to cash on delivery; existing ledger entries are not rewritten.";
}

export const historyParser = {
  safeParse(input: unknown): { success: true; data: RateHistoryList } | { success: false } {
    const value = input as Partial<RateHistoryList> | null;
    if (!value || !Array.isArray(value.docs) || typeof value.page !== "number" || typeof value.totalPages !== "number") return { success: false };
    return { success: true, data: value as RateHistoryList };
  },
};

export const loose = {
  safeParse(input: unknown): { success: true; data: Record<string, unknown> } | { success: false } {
    return input !== null && typeof input === "object" ? { success: true, data: input as Record<string, unknown> } : { success: false };
  },
};
