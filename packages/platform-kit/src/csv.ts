/**
 * The one CSV cell guard of the report downloads (first written for the admin audit export, Sprint 6; shared since Sprint 8, S8-B7). A text cell that starts
 * with = + - @ (or a tab or a return) gets a leading apostrophe, so a spreadsheet can never run it as a formula; a plain E.164 phone number (+ and 7 to 15
 * digits) is text, never a formula, and is left alone. Every cell is quoted; numbers are written as numbers. Files start with a UTF-8 byte order mark.
 * Pure.
 */

export const CSV_BOM = String.fromCharCode(0xfeff);

const FORMULA_START = /^[=+\-@\t\r]/;
const E164 = /^\+[0-9]{7,15}$/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : '""';
  const guarded = FORMULA_START.test(value) && !E164.test(value) ? "'" + value : value;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

/** One line of a file, with its CRLF. */
export const csvLine = (cells: ReadonlyArray<string | number | null | undefined>): string => cells.map(csvCell).join(",") + "\r\n";
