/**
 * Sprint 4 EP-05.US03, US06 (D-088, D-090): the checks, labels and sentences of the payout screens. Pure: no I/O. The backend
 * checks everything again; these only keep a form from sending what cannot work and keep the wording in one place.
 * Money is whole rupees.
 */

export const PAYOUT_METHODS = ["bank", "jazzcash", "easypaisa"] as const;
export type PayoutMethodValue = (typeof PAYOUT_METHODS)[number];

export const PAYOUT_METHOD_LABELS: Record<PayoutMethodValue, string> = { bank: "Bank transfer", jazzcash: "JazzCash", easypaisa: "Easypaisa" };

export const PAYOUT_STATUS_VALUES = ["pending_settle", "paid", "voided", "failed"] as const;
export type PayoutStatusFilter = (typeof PAYOUT_STATUS_VALUES)[number];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatusFilter, string> = {
  pending_settle: "Stuck: not settled",
  paid: "Paid",
  voided: "Voided",
  failed: "Failed",
};

export const REFERENCE_MAX = 100;
export const NOTE_MAX = 500;
export const VOID_REASON_MIN = 3;
export const VOID_REASON_MAX = 500;

export const REPORT_PERIODS = ["today", "7", "30", "90", "custom"] as const;
export type ReportPeriodValue = (typeof REPORT_PERIODS)[number];
export const REPORT_PERIOD_LABELS: Record<ReportPeriodValue, string> = {
  today: "Today",
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  custom: "Custom range",
};

/** "Rs. 12,500". A negative amount reads "-Rs. 500" (the seller owes the platform). */
export function formatRupees(amount: number): string {
  if (!Number.isFinite(amount)) return "-";
  const whole = Math.round(amount);
  return (whole < 0 ? "-" : "") + "Rs. " + Math.abs(whole).toLocaleString("en-US");
}

/**
 * Sprint 6 EP-12.US04.T04 (D-116): the report split by payment kind, as the dialog shows it. Null when the backend sent no split (an older seller
 * backend). The labels match the CSV's "Payment type" column.
 */
export interface ReportPartLine {
  key: "cod" | "gateway";
  label: string;
  commissionEarned: number;
  sales: number;
  ordersCount: number;
  /** A COD row that carried no commission: the dialog says so in words. */
  noCommission: boolean;
}

export function reportBreakdown(report: {
  cod?: { commissionEarned: number; sales: number; ordersCount: number };
  gateway?: { commissionEarned: number; sales: number; ordersCount: number };
}): ReportPartLine[] | null {
  if (!report.cod && !report.gateway) return null;
  const lines: ReportPartLine[] = [];
  if (report.cod) lines.push({ key: "cod", label: "Cash on delivery", ...report.cod, noCommission: report.cod.commissionEarned === 0 && report.cod.sales > 0 });
  if (report.gateway) lines.push({ key: "gateway", label: "Gateway (card)", ...report.gateway, noCommission: false });
  return lines;
}

export function entriesLabel(count: number): string {
  return count + (count === 1 ? " entry" : " entries");
}

export interface PayoutFormInput {
  method: string;
  reference: string;
  note: string;
}

export interface PayoutFormIssues {
  method?: string;
  reference?: string;
  note?: string;
}

/** The first problems of the create form, by field. An empty object means it can go to the confirmation step. */
export function payoutFormIssues(input: PayoutFormInput): PayoutFormIssues {
  const issues: PayoutFormIssues = {};
  if (!(PAYOUT_METHODS as readonly string[]).includes(input.method)) issues.method = "Choose how the money was sent.";
  const reference = input.reference.trim();
  if (reference === "") issues.reference = "Enter the transfer reference, for example the bank or wallet transaction number.";
  else if (reference.length > REFERENCE_MAX) issues.reference = "Use at most " + REFERENCE_MAX + " characters.";
  if (input.note.trim().length > NOTE_MAX) issues.note = "Use at most " + NOTE_MAX + " characters.";
  return issues;
}

/** Whether a balance row can be paid, and if not, why. A zero or negative balance carries forward. */
export function payBlockReason(row: { balance: number; hasPayoutDetails: boolean; emailVerified: boolean; hasPendingPayout: boolean }): string | null {
  if (row.hasPendingPayout) return "A payout of this store is stuck. Finish or release it in the payout history first.";
  if (row.balance <= 0) return row.balance === 0 ? "Nothing to pay." : "The store owes the platform. This carries forward into its next payout.";
  if (!row.hasPayoutDetails) return "The seller has not saved payout details yet.";
  if (!row.emailVerified) return "The seller has not verified their email address yet.";
  return null;
}

/** The confirmation sentence of the payout dialog: what recording this payout does. */
export function describePayout(storeName: string, amount: number, method: string, reference: string): string {
  const label = (PAYOUT_METHOD_LABELS as Record<string, string>)[method] ?? method;
  return (
    "You are recording that " +
    formatRupees(amount) +
    " was sent to " +
    storeName +
    " by " +
    label +
    ", reference " +
    reference.trim() +
    ". Every unsettled ledger entry of the store up to now is settled, and the seller is told by email. You can void it later with a reason."
  );
}

export function describeVoid(storeName: string, amount: number): string {
  return (
    "You are voiding the payout of " +
    formatRupees(amount) +
    " to " +
    storeName +
    ". Its ledger entries count in the store's balance again and the seller is told by email."
  );
}

/** The one-line summary of a stored account for a table: "JazzCash, ending 4567". */
export function accountSummary(method: string | null, last4: string | null): string {
  if (method === null || last4 === null || last4 === "") return "No payout details";
  const label = (PAYOUT_METHOD_LABELS as Record<string, string>)[method] ?? method;
  return label + ", ending " + last4;
}

/** The query string of /api/commission/report (and of its CSV link). The custom days are only sent for a custom period. */
export function reportQuery(input: { storeId: string; period: ReportPeriodValue; from: string; to: string }, format?: "csv"): string {
  const params = new URLSearchParams({ storeId: input.storeId, period: input.period });
  if (input.period === "custom") {
    if (input.from !== "") params.set("from", input.from);
    if (input.to !== "") params.set("to", input.to);
  }
  if (format) params.set("format", format);
  return params.toString();
}

/** Whether the report can be asked for: a custom period needs both days, with the first not after the last. */
export function reportInputIssue(input: { period: ReportPeriodValue; from: string; to: string }): string | null {
  if (input.period !== "custom") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) return "Choose the first and the last day.";
  if (input.to < input.from) return "The last day must not be before the first day.";
  return null;
}
