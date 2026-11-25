import { z } from 'zod';

/*
 * Sprint 8 (S8-B7, D-118): the sales report of a store, a CSV download for the owner and a manager. It holds NO customer name, phone, email or address.
 * from and to are Pakistan calendar days, both included (as the order list reads them).
 */

export const SALES_REPORT_ROW_CAP = 10_000;
export const SALES_REPORT_MAX_DAYS = 366;

export const SALES_REPORT_STATUSES = ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'] as const;
/** cod: cash on delivery (an order with no recorded method is one). card: the gateway. */
export const SALES_REPORT_METHODS = ['cod', 'card'] as const;

export const SALES_REPORT_COLUMNS = ['Order number', 'Date (ISO)', 'Status', 'Payment method', 'Subtotal', 'Discount', 'Delivery', 'Tax', 'Total', 'Commission'] as const;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'use the format YYYY-MM-DD', abort: true })
  .refine((value) => {
    const date = new Date(value + 'T00:00:00.000Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'this is not a real date');

/** GET /api/stores/:id/reports/sales?from&to&status&method */
export const salesReportQuerySchema = z.strictObject({
  from: day.optional(),
  to: day.optional(),
  status: z.enum(SALES_REPORT_STATUSES, { error: 'choose an order status' }).optional(),
  method: z.enum(SALES_REPORT_METHODS, { error: 'choose cod or card' }).optional(),
});
export type SalesReportQuery = z.output<typeof salesReportQuerySchema>;
export type SalesReportStatus = (typeof SALES_REPORT_STATUSES)[number];
export type SalesReportMethod = (typeof SALES_REPORT_METHODS)[number];
