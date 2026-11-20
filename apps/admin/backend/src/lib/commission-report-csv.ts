import type { CommissionReport } from '../../../../../packages/contracts/src/payouts';

/**
 * Sprint 4 EP-05.US06 (D-090): the CSV of the commission report. A pure function: no I/O, no clock.
 *
 *   - starts with a UTF-8 byte order mark, so Excel reads store names in Urdu correctly
 *   - every text cell is quoted and its quotes are doubled, so a comma, a quote or a line break in a store name stays in its cell
 *   - a text cell that starts with = + - @ (or a tab or carriage return) is prefixed with an apostrophe, so a spreadsheet
 *     never runs a store name as a formula
 *   - a number is written as it is: it comes from the ledger, never from a person, and a negative balance must stay a number
 *   - lines end with CRLF, as RFC 4180 says
 */

export const CSV_BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '""';
  const guarded = FORMULA_START.test(value) ? "'" + value : value;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

export const COMMISSION_REPORT_HEADER = ['Store', 'Store id', 'Period', 'From', 'To', 'Commission earned (Rs)', 'Sales (Rs)', 'Orders', 'Balance (Rs)'] as const;

export function buildCommissionReportCsv(reports: readonly CommissionReport[]): string {
  const lines = [COMMISSION_REPORT_HEADER.map((name) => csvCell(name)).join(',')];
  for (const report of reports) {
    lines.push(
      [
        csvCell(report.storeName),
        csvCell(report.storeId),
        csvCell(report.period.key),
        csvCell(report.period.from),
        csvCell(report.period.to),
        csvCell(report.commissionEarned),
        csvCell(report.sales),
        csvCell(report.ordersCount),
        csvCell(report.balance),
      ].join(','),
    );
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/** A file name made of the id and the days only, never of a store name. */
export function commissionReportFileName(report: Pick<CommissionReport, 'storeId' | 'period'>): string {
  return 'commission-report-' + report.storeId + '-' + report.period.from + '-to-' + report.period.to + '.csv';
}
