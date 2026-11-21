/**
 * Sprint 4 EP-05.US04 (D-090): the checks, labels and query of the seller's earnings page. Pure: no I/O.
 * Money is WHOLE RUPEES. The numbers come from the commission ledger through GET /api/stores/:id/earnings; nothing here
 * computes a total.
 */

export const EARNINGS_PERIODS = ["today", "7", "30", "90", "custom"] as const;
export type EarningsPeriodValue = (typeof EARNINGS_PERIODS)[number];

export const PERIOD_LABELS: Record<EarningsPeriodValue, string> = {
  today: "Today",
  "7": "7 days",
  "30": "30 days",
  "90": "90 days",
  custom: "Custom",
};

export const ENTRY_TYPES = ["cod_commission", "card_sale", "card_commission", "reversal"] as const;
export type EntryTypeValue = (typeof ENTRY_TYPES)[number];

export const ENTRY_TYPE_LABELS: Record<EntryTypeValue, string> = {
  cod_commission: "COD commission",
  card_sale: "Card sale",
  card_commission: "Card commission",
  reversal: "Reversal",
};

export interface EarningsEntry {
  id: string;
  type: EntryTypeValue;
  reversesType: "cod_commission" | "card_sale" | "card_commission" | null;
  orderId: string;
  orderNumber: string | null;
  amount: number;
  baseAmount: number;
  rate: number;
  settled: boolean;
  createdAt: string;
}

export interface EarningsPayout {
  id: string;
  amount: number;
  method: "bank" | "jazzcash" | "easypaisa";
  reference: string;
  status: "pending_settle" | "paid" | "voided" | "failed";
  createdAt: string;
}

export interface EarningsData {
  period: { key: EarningsPeriodValue; from: string; to: string; start: string; end: string };
  summary: { sales: number; commission: number; net: number };
  allTime: { balance: number; totalPaidOut: number };
  entries: { docs: EarningsEntry[]; page: number; limit: number; totalDocs: number; totalPages: number };
  payouts: EarningsPayout[];
  /** Sprint 5 EP-13: the part of the summary that came from refunded returns (already netted into it). Absent from an older backend. */
  returns?: { count: number; sales: number; commission: number };
  /** Sprint 6 D-116: the cash-on-delivery part of the summary (already counted in it). Absent from an older backend. */
  cod?: { orders: number; sales: number; commission: number };
}

/** The rates of one store (GET /api/stores/:id/commission). Older backends send only rate and source. */
export interface CommissionRates {
  /** Card (gateway) orders: the store's own rate or the standard one. */
  gatewayRate: number;
  gatewaySource: "custom" | "default";
  /** Cash on delivery: the platform's COD percent. 0 means no commission on COD. */
  codRate: number;
}

/** "PKR 12,500". A negative amount reads "-PKR 500". */
export function formatPkr(amount: number): string {
  if (!Number.isFinite(amount)) return "-";
  const whole = Math.round(amount);
  return (whole < 0 ? "-" : "") + "PKR " + Math.abs(whole).toLocaleString("en-US");
}

/** A signed amount for the entries table: "+PKR 2,000" or "-PKR 80". */
export function formatSignedPkr(amount: number): string {
  return (amount > 0 ? "+" : "") + formatPkr(amount);
}

export function entryLabel(entry: Pick<EarningsEntry, "type" | "reversesType">): string {
  if (entry.type === "reversal" && entry.reversesType !== null) return "Reversal of " + ENTRY_TYPE_LABELS[entry.reversesType].toLowerCase();
  return ENTRY_TYPE_LABELS[entry.type];
}

export const PAYOUT_METHOD_NAMES: Record<EarningsPayout["method"], string> = { bank: "Bank transfer", jazzcash: "JazzCash", easypaisa: "Easypaisa" };

/** The wording of a payout status for a seller. pending_settle and failed are not shown to sellers, but are worded if they ever arrive. */
export function payoutStatusLabel(status: EarningsPayout["status"]): string {
  if (status === "paid") return "Paid";
  if (status === "voided") return "Cancelled";
  if (status === "failed") return "Failed";
  return "Processing";
}

/** The first problem of a custom range, or null: both days, the first not after the last. */
export function customRangeProblem(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "Choose the first and the last day.";
  if (to < from) return "The last day must not be before the first day.";
  return null;
}

export interface EarningsQueryInput {
  period: EarningsPeriodValue;
  from: string;
  to: string;
  page: number;
  type: EntryTypeValue | "";
}

/** The query string of /api/dashboard/earnings. The default period (30) and the first page are left out; custom days only for custom. */
export function earningsQuery(input: EarningsQueryInput): string {
  const params = new URLSearchParams();
  if (input.period !== "30") params.set("period", input.period);
  if (input.period === "custom") {
    params.set("from", input.from);
    params.set("to", input.to);
  }
  if (input.page > 1) params.set("page", String(input.page));
  if (input.type !== "") params.set("type", input.type);
  return params.toString();
}

/** What the page says about the money all time: owed to the seller, or owed by the seller. */
export function balanceHint(balance: number): string {
  if (balance > 0) return "Not paid out yet. The platform pays this to your payout account.";
  if (balance < 0) return "You owe the platform this amount. It is taken from your next payout.";
  return "Nothing is waiting to be paid out.";
}

/** A percent without a trailing zero: 4 -> "4%", 2.5 -> "2.5%". */
export function formatPercent(rate: number): string {
  return (Number.isInteger(rate) ? String(rate) : String(Math.round(rate * 10) / 10)) + "%";
}

/**
 * Reads the answer of /api/dashboard/commission. A newer backend sends gatewayRate and codRate; an older one only rate and source (then
 * COD is taken as 0, which is what it charged nothing for). Returns null for anything unusable, and the page hides the line.
 */
export function readCommissionRates(body: unknown): CommissionRates | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const gateway = typeof record.gatewayRate === "number" ? record.gatewayRate : typeof record.rate === "number" ? record.rate : null;
  const source = record.source === "custom" || record.source === "default" ? record.source : null;
  if (gateway === null || source === null || !Number.isFinite(gateway) || gateway < 0 || gateway > 100) return null;
  const cod = typeof record.codRate === "number" && Number.isFinite(record.codRate) && record.codRate >= 0 && record.codRate <= 100 ? record.codRate : 0;
  return { gatewayRate: gateway, gatewaySource: source, codRate: cod };
}

/**
 * What the commission tile says about the rates. While the COD percent is 0 the page says the card rate and that cash on delivery carries
 * no commission; when it is not 0 it says both rates.
 */
export function commissionRatesText(rates: CommissionRates): string {
  const card = formatPercent(rates.gatewayRate) + (rates.gatewaySource === "custom" ? " (your rate)" : " (standard rate)");
  if (rates.codRate === 0) return "Card orders " + card + ". Cash on delivery: no commission.";
  return "Card orders " + card + ". Cash on delivery " + formatPercent(rates.codRate) + ".";
}

/** A ledger row of a COD order that carried no commission (the percent was 0 when it was collected). */
export function isNoCommissionEntry(entry: Pick<EarningsEntry, "type" | "amount" | "rate">): boolean {
  return entry.type === "cod_commission" && entry.amount === 0 && entry.rate === 0;
}

/** The type column: a zero COD row says "COD sale, no commission" instead of "COD commission" with PKR 0. */
export function entryTypeText(entry: Pick<EarningsEntry, "type" | "reversesType" | "amount" | "rate">): string {
  if (isNoCommissionEntry(entry)) return "COD sale (no commission)";
  if (entry.type === "reversal" && entry.reversesType === "cod_commission" && entry.amount === 0 && entry.rate === 0) return "Reversal of COD sale (no commission)";
  return entryLabel(entry);
}

/** The amount column: "No commission" for a zero COD row, else the signed amount. */
export function entryAmountText(entry: Pick<EarningsEntry, "type" | "reversesType" | "amount" | "rate">): string {
  if (isNoCommissionEntry(entry) || (entry.type === "reversal" && entry.reversesType === "cod_commission" && entry.amount === 0 && entry.rate === 0)) return "No commission";
  return formatSignedPkr(entry.amount);
}

/**
 * The line under the summary about cash on delivery: with a COD percent of 0, "COD sales PKR 2,000 (3 orders): no commission"; with a percent
 * above 0 the commission they paid. Null when there were no COD sales in the period (or the backend does not send them).
 */
export function codSalesLine(cod: EarningsData["cod"], rates: CommissionRates | null): string | null {
  if (!cod || cod.orders <= 0 || cod.sales <= 0) return null;
  const orders = cod.orders + (cod.orders === 1 ? " order" : " orders");
  const noCommission = (rates !== null && rates.codRate === 0 && cod.commission === 0) || (rates === null && cod.commission === 0);
  if (noCommission) return "Cash on delivery sales: " + formatPkr(cod.sales) + " (" + orders + "), no commission.";
  return "Cash on delivery sales: " + formatPkr(cod.sales) + " (" + orders + "), commission " + formatPkr(cod.commission) + ".";
}
