import { SALES_REPORT_ROW_CAP, SALES_REPORT_STATUSES } from "@markaz/contracts/sales-report";

/**
 * Sprint 8 (S8-B7, D-118): the sales report download of the analytics and orders pages. Pure: the address, the file name and the words. The file holds no
 * customer name, phone, email or address.
 */

export interface SalesExportFilters {
  /** Pakistan days, YYYY-MM-DD, or "" for the report's own default (the last 366 days). */
  from?: string;
  to?: string;
  status?: string;
  method?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAKISTAN_OFFSET_MS = 5 * 3_600_000;

export function salesExportHref(storeId: string, filters: SalesExportFilters): string {
  const params = new URLSearchParams();
  if (filters.from && DAY.test(filters.from)) params.set("from", filters.from);
  if (filters.to && DAY.test(filters.to)) params.set("to", filters.to);
  if (filters.status && (SALES_REPORT_STATUSES as readonly string[]).includes(filters.status)) params.set("status", filters.status);
  if (filters.method === "cod" || filters.method === "card") params.set("method", filters.method);
  const query = params.toString();
  return `/api/proxy/stores/${encodeURIComponent(storeId)}/reports/sales` + (query === "" ? "" : "?" + query);
}

/** The last N days ending today, as the analytics period shows them, in Pakistan days. */
export function periodRange(days: number, now: Date): { from: string; to: string } {
  const today = new Date(now.getTime() + PAKISTAN_OFFSET_MS);
  const day = (back: number) => new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
  return { from: day(days - 1), to: day(0) };
}

export const salesFileName = (disposition: string | null): string => /filename="([A-Za-z0-9_.-]+)"/.exec(disposition ?? "")?.[1] ?? "sales.csv";

export const TRUNCATED_MESSAGE = `Your filters match more than ${SALES_REPORT_ROW_CAP.toLocaleString("en-US")} orders. The file holds the newest ${SALES_REPORT_ROW_CAP.toLocaleString("en-US")}; choose a shorter period for the rest.`;

export const isTruncated = (headers: { get(name: string): string | null }): boolean => headers.get("x-report-truncated") === "1";

export const EXPORT_HELP = "A CSV of orders with amounts and commission. It has no customer details.";
