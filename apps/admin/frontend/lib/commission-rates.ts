/**
 * Sprint 4 EP-05.US02 (D-089): the wire shapes and checks of the commission rate screens. A rate is a percentage from 0
 * to 100 with at most one decimal; the backend checks it again.
 */

export const RATE_MAX = 100;
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
  return subject + ": " + label(from) + " to " + label(to) + ". It applies to orders delivered or paid after this change; existing ledger entries are not rewritten.";
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
