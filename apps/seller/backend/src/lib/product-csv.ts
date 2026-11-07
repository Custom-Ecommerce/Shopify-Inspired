/*
 * CSV as RFC 4180 reads it: quoted cells may hold commas, line breaks and doubled quotes. Pure, no I/O. The seller backend
 * parses here rather than in the browser so the size and row limits cannot be skipped by a caller.
 */

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvFormatError';
  }
}

/** Every record, as cells. Lines with nothing on them are dropped. A byte order mark is ignored. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let cellStarted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endCell = (): void => {
    record.push(cell);
    cell = '';
    cellStarted = false;
  };
  const endRecord = (): void => {
    endCell();
    if (record.some((value) => value !== '')) records.push(record);
    record = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
    } else if (char === ',') {
      endCell();
    } else if (char === '\n') {
      endRecord();
    } else if (char === '\r') {
      if (source.charAt(index + 1) === '\n') index += 1;
      endRecord();
    } else {
      cell += char;
      cellStarted = true;
    }
  }
  if (quoted) throw new CsvFormatError('A quoted cell is never closed.');
  if (cell !== '' || record.length > 0) endRecord();
  return records;
}

/** A formula start, behind any number of apostrophes: what neutraliseCell protects and restoreCell undoes. */
const QUOTED_FORMULA_START = /^'*[=+\-@\t\r]/;

/**
 * A spreadsheet runs a cell that starts like this as a formula, so an export writes it as text with one apostrophe in
 * front. A cell that already starts with apostrophes before a formula character gets one more too (GAP 9): otherwise the
 * seller's own '=x would come back as =x, because restoreCell cannot tell their apostrophe from ours.
 */
export function neutraliseCell(value: string): string {
  return QUOTED_FORMULA_START.test(value) ? "'" + value : value;
}

/** Takes off exactly the one apostrophe neutraliseCell added. Any other leading quote is the seller's own. */
export function restoreCell(value: string): string {
  return value.startsWith("'") && QUOTED_FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

/** What an import says about a row whose text a wrong file encoding has already damaged (GAP 4). */
export const DAMAGED_TEXT_MESSAGE = 'This text looks damaged by the wrong file encoding. Save the file as CSV UTF-8 and import again.';

/** What a 0x80-0x9F byte becomes when Windows-1252 reads it (Excel's ANSI). Latin-1 reads it as U+0080-U+009F. */
const CP1252_HIGH =
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
/** A UTF-8 continuation byte (0x80-0xBF) as Latin-1 or Windows-1252 shows it. */
const TRAIL = '[\u0080-¿' + CP1252_HIGH + ']';
/**
 * A UTF-8 sequence read one byte per character: a lead byte (0xC2-0xDF for two bytes, which covers Urdu and Arabic as
 * Ø Ù Ú Û, or 0xE0-0xEF for three) shown as a Latin-1 letter, then its continuation bytes. "اردو" becomes "Ø§Ø±Ø¯Ùˆ".
 */
const MOJIBAKE = new RegExp('[Â-ß]' + TRAIL + '|[à-ï]' + TRAIL + TRAIL, 'g');

/**
 * True when a cell holds text that was damaged before it reached us, so storing it would corrupt the product silently:
 *   - the replacement character U+FFFD, which a decoder leaves where it could not read a byte;
 *   - two or more UTF-8 sequences read as Latin-1/Windows-1252 (one alone is not enough, so a rare real pairing passes);
 *   - for prose (Title, Description): a run of 3+ question marks that make up more than half the cell, which is what a
 *     plain Excel "CSV" save leaves of Urdu ("???? ?????").
 * Real Urdu, accented Latin ("Café", "Øl", "São") and an ordinary "What?" or "Really???" all pass.
 */
export function looksDamaged(value: string, prose = false): boolean {
  if (value.includes('�')) return true;
  if ((value.match(MOJIBAKE) ?? []).length >= 2) return true;
  if (prose && /\?{3,}/.test(value)) {
    const marks = value.length - value.replace(/\?/g, '').length;
    if (marks * 2 > value.length) return true;
  }
  return false;
}

function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** U+FEFF. Without it Excel opens a UTF-8 file as ANSI and turns Urdu into "Ø§Ø±Ø¯Ùˆ" (GAP 4). parseCsv drops it again. */
export const UTF8_BOM = '﻿';

/**
 * A CSV file. Every cell is neutralised, so nothing a seller typed can run in a spreadsheet. It starts with a UTF-8 byte
 * order mark (bytes EF BB BF once encoded), so Excel reads it as UTF-8: every file we hand a seller (export, template,
 * failed rows) goes through here.
 */
export function serializeCsv(records: ReadonlyArray<readonly string[]>): string {
  return UTF8_BOM + records.map((record) => record.map((cell) => quoteCell(neutraliseCell(cell))).join(',')).join('\r\n') + '\r\n';
}
