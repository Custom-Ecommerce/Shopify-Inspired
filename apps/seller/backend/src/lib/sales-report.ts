import mongoose from 'mongoose';
import * as csvNs from '@markaz/platform-kit/csv';
import type { SalesReportQuery } from '@markaz/contracts';
import { auditActorOf, type AuthContext } from '@/lib/auth';
import { unwrapCjs } from '@/lib/cjs';
import { SALES_REPORT_COLUMNS, SALES_REPORT_MAX_DAYS, SALES_REPORT_ROW_CAP } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { createdAtRange, pakistanDayStart } from '@/lib/orders';
import { CommissionEntry, Order, writeAuditLog } from '@/lib/services';

/*
 * Sprint 8 (S8-B7, D-118): the sales report. One CSV line per order of ONE store, newest first, at most SALES_REPORT_ROW_CAP (the cap is applied after the
 * sort, so a cut file holds the newest orders), read with a cursor in batches of 500 and streamed. UTF-8 with a BOM; every text cell goes through the shared
 * formula guard (@markaz/platform-kit/csv). The order's customer is not read: no name, phone, email or address can be in the file.
 *
 * Commission is what the ledger holds for the order: its commission entries net of their reversals (a cancelled or returned order shows what is left, often 0).
 * A cash-on-delivery order at 0% has an entry and shows 0; an order with no entry (not delivered or paid yet) shows nothing.
 */

const { CSV_BOM, csvLine } = unwrapCjs(csvNs) as typeof csvNs;

type Row = Record<string, any>;

export const SALES_REPORT_BATCH = 500;
const DAY_MS = 86_400_000;
const PAKISTAN_OFFSET_MS = 5 * 3_600_000;
const COMMISSION_TYPES = ['cod_commission', 'card_commission'];
/** The only fields of an order this report reads. */
export const SALES_REPORT_SELECT = 'orderId createdAt status paymentMethod subtotal discountAmount deliveryCharges taxAmount total';

export const TRUNCATED_NOTE = 'Truncated: only the newest ' + SALES_REPORT_ROW_CAP + ' orders are in this file. Narrow the dates or the filters.';

const addDays = (day: string, days: number): string => new Date(Date.parse(day + 'T00:00:00.000Z') + days * DAY_MS).toISOString().slice(0, 10);

export interface ReportRange {
  from: string;
  to: string;
}

/** The days of the report. Missing "to" is today (or from + 365 if sooner), missing "from" is 365 days before "to". At most 366 days. */
export function resolveReportRange(query: Pick<SalesReportQuery, 'from' | 'to'>, now: Date): ReportRange {
  const today = new Date(now.getTime() + PAKISTAN_OFFSET_MS).toISOString().slice(0, 10);
  const span = SALES_REPORT_MAX_DAYS - 1;
  const to = query.to ?? (query.from !== undefined && addDays(query.from, span) < today ? addDays(query.from, span) : today);
  const from = query.from ?? addDays(to, -span);
  if (from > to) throw new HttpError(400, 'The start date is after the end date.', 'ACCOUNT_BODY_INVALID', 'from');
  const days = (pakistanDayStart(to).getTime() - pakistanDayStart(from).getTime()) / DAY_MS + 1;
  if (days > SALES_REPORT_MAX_DAYS) throw new HttpError(400, 'A report covers at most ' + SALES_REPORT_MAX_DAYS + ' days.', 'ACCOUNT_BODY_INVALID', 'to');
  return { from, to };
}

export function salesReportFilter(storeId: string, query: SalesReportQuery, range: ReportRange): Record<string, unknown> {
  return {
    store: new mongoose.Types.ObjectId(storeId),
    createdAt: createdAtRange(range.from, range.to),
    ...(query.status ? { status: query.status } : {}),
    ...(query.method === 'card' ? { paymentMethod: 'card' } : query.method === 'cod' ? { paymentMethod: { $ne: 'card' } } : {}),
  };
}

const rupees = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);

/** The commission the ledger holds for each of these orders of the store: minus the balance effect, net of reversals. */
async function commissionsOf(storeId: string, orderIds: unknown[]): Promise<Map<string, number>> {
  const entries = (await CommissionEntry.find({
    store: storeId,
    order: { $in: orderIds },
    $or: [{ type: { $in: COMMISSION_TYPES } }, { type: 'reversal', reversesType: { $in: COMMISSION_TYPES } }],
  } as never)
    .select('order balanceEffect')
    .lean()) as unknown as Row[];
  const sums = new Map<string, number>();
  for (const entry of entries) sums.set(String(entry.order), (sums.get(String(entry.order)) ?? 0) - rupees(entry.balanceEffect));
  return sums;
}

function reportLine(row: Row, commission: number | undefined): string {
  const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  return csvLine([
    String(row.orderId ?? ''),
    Number.isNaN(created.getTime()) ? '' : created.toISOString(),
    String(row.status ?? ''),
    row.paymentMethod === 'card' ? 'Card' : 'COD',
    rupees(row.subtotal),
    rupees(row.discountAmount),
    rupees(row.deliveryCharges),
    rupees(row.taxAmount),
    rupees(row.total),
    // "+ 0" turns a negative zero into 0.
    commission === undefined ? null : commission + 0,
  ]);
}

/** The file, piece by piece: the header, then one piece per batch of orders. */
export async function* salesReportPieces(storeId: string, filter: Record<string, unknown>, truncated: boolean): AsyncGenerator<string> {
  yield CSV_BOM + (truncated ? csvLine([TRUNCATED_NOTE]) : '') + csvLine([...SALES_REPORT_COLUMNS]);
  const cursor = Order.find(filter as never)
    .sort({ createdAt: -1, _id: -1 })
    .limit(SALES_REPORT_ROW_CAP)
    .select(SALES_REPORT_SELECT)
    .lean()
    .cursor({ batchSize: SALES_REPORT_BATCH }) as unknown as AsyncIterable<Row>;
  let batch: Row[] = [];
  const flush = async (): Promise<string> => {
    const commissions = await commissionsOf(storeId, batch.map((row) => row._id));
    const text = batch.map((row) => reportLine(row, commissions.get(String(row._id)))).join('');
    batch = [];
    return text;
  };
  for await (const row of cursor) {
    batch.push(row);
    if (batch.length === SALES_REPORT_BATCH) yield await flush();
  }
  if (batch.length > 0) yield await flush();
}

function streamOf(pieces: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await pieces.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        // A failure part way must not read as a complete file: the download fails.
        console.error('[seller-backend] the sales report could not be read', err instanceof Error ? err.name : 'unknown');
        controller.error(err);
      }
    },
    async cancel() {
      await pieces.return(undefined);
    },
  });
}

/** Counts, audits (fails closed: no entry, no file), then streams. */
export async function salesReportResponse(storeId: string, ctx: AuthContext, query: SalesReportQuery, range: ReportRange): Promise<Response> {
  const filter = salesReportFilter(storeId, query, range);
  const total = await Order.countDocuments(filter as never);
  const rows = Math.min(total, SALES_REPORT_ROW_CAP);
  const truncated = total > SALES_REPORT_ROW_CAP;
  try {
    await writeAuditLog('report.sales_exported', 'store', storeId, auditActorOf(ctx), {
      role: ctx.storeRole ?? 'owner',
      filters: { from: range.from, to: range.to, status: query.status ?? null, method: query.method ?? null },
      rows,
      truncated,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the sales report audit entry', err instanceof Error ? err.name : 'unknown');
    throw new HttpError(503, 'The report could not be made because its audit entry could not be written.');
  }
  return new Response(streamOf(salesReportPieces(storeId, filter, truncated)), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sales-' + range.from + '-to-' + range.to + '.csv"',
      'Cache-Control': 'no-store',
      'X-Report-Rows': String(rows),
      'X-Report-Row-Cap': String(SALES_REPORT_ROW_CAP),
      ...(truncated ? { 'X-Report-Truncated': '1' } : {}),
    },
  });
}
