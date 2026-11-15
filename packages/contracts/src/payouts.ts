import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { containsHtmlTag } from './product';
import { moderationReasonSchema } from './moderation';
import { PAYOUT_METHODS } from './store-settings';

/*
 * Sprint 4 EP-05.US03, US04, US06 (D-088, D-090, D-100): earnings, payouts and the commission report.
 *
 * Everything is WHOLE RUPEES. The ledger (CommissionEntry) and the payouts live in the SELLER database. The admin backend
 * reaches them through signed internal routes of the seller backend (the same signature as moderation), so the request
 * and answer shapes here are shared by the seller backend, the admin backend and the admin console.
 */

export const PAYOUT_STATUS_VALUES = ['pending_settle', 'paid', 'voided', 'failed'] as const;
export type PayoutStatusValue = (typeof PAYOUT_STATUS_VALUES)[number];

export const PAYOUT_REFERENCE_MAX = 100;
export const PAYOUT_NOTE_MAX = 500;
export const PAYOUT_LIST_DEFAULT_LIMIT = 20;
export const PAYOUT_LIST_MAX_LIMIT = 50;
export const PAYOUT_SEARCH_MAX_LENGTH = 80;

/** The codes a payout answer carries next to its status. */
export const PAYOUT_CODES = {
  /** 409: the balance moved since the admin looked. Reload and pay the new amount. */
  BALANCE_CHANGED: 'PAYOUT_BALANCE_CHANGED',
  /** 409: another payout of this store is still being settled. */
  IN_PROGRESS: 'PAYOUT_IN_PROGRESS',
  /** 409: the balance is zero or negative: nothing can be paid, it carries forward. */
  NOTHING_TO_PAY: 'PAYOUT_NOTHING_TO_PAY',
  /** 409: the seller has not saved payout details. */
  NO_PAYOUT_DETAILS: 'PAYOUT_NO_DETAILS',
  /** 409: the payout is not in a state this step applies to. */
  WRONG_STATE: 'PAYOUT_WRONG_STATE',
} as const;

// ----------------------------------------------------------------------------------------------------------- periods

/** Pakistan Standard Time is UTC+5 all year (no daylight saving), so a day boundary is a fixed offset from UTC. */
export const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const EARNINGS_PERIODS = ['today', '7', '30', '90', 'custom'] as const;
export type EarningsPeriod = (typeof EARNINGS_PERIODS)[number];
export const EARNINGS_CUSTOM_MAX_DAYS = 366;

/** The instant the Asia/Karachi calendar day of `instant` began. */
export function karachiDayStart(instant: Date): Date {
  const shifted = instant.getTime() + KARACHI_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - KARACHI_OFFSET_MS);
}

/** "YYYY-MM-DD" read as an Asia/Karachi calendar day: the instant it begins, or null when it is not a real date. */
export function parseKarachiDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return new Date(utc.getTime() - KARACHI_OFFSET_MS);
}

/** "YYYY-MM-DD" of the Asia/Karachi day an instant falls in. */
export function karachiDayLabel(instant: Date): string {
  return new Date(instant.getTime() + KARACHI_OFFSET_MS).toISOString().slice(0, 10);
}

export interface PeriodInput {
  period: EarningsPeriod;
  from?: string | undefined;
  to?: string | undefined;
}

export type ResolvedPeriod = { ok: true; period: EarningsPeriod; start: Date; end: Date } | { ok: false; field: string; message: string };

/**
 * The [start, end) range of a period, on Asia/Karachi day boundaries: the start is included, the end is not.
 *   today        this Karachi day so far
 *   7 | 30 | 90  the last N Karachi days, today included
 *   custom       from and to are both days that are INCLUDED (so end is the start of the day after `to`)
 */
export function resolvePeriod(input: PeriodInput, now: Date): ResolvedPeriod {
  const today = karachiDayStart(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  switch (input.period) {
    case 'today':
      return { ok: true, period: 'today', start: today, end: tomorrow };
    case '7':
    case '30':
    case '90': {
      const days = Number(input.period);
      return { ok: true, period: input.period, start: new Date(tomorrow.getTime() - days * DAY_MS), end: tomorrow };
    }
    case 'custom': {
      if (!input.from) return { ok: false, field: 'from', message: 'choose the first day' };
      if (!input.to) return { ok: false, field: 'to', message: 'choose the last day' };
      const start = parseKarachiDay(input.from);
      if (start === null) return { ok: false, field: 'from', message: 'use a date such as 2026-11-01' };
      const last = parseKarachiDay(input.to);
      if (last === null) return { ok: false, field: 'to', message: 'use a date such as 2026-11-30' };
      if (last.getTime() < start.getTime()) return { ok: false, field: 'to', message: 'the last day must not be before the first day' };
      const end = new Date(last.getTime() + DAY_MS);
      if ((end.getTime() - start.getTime()) / DAY_MS > EARNINGS_CUSTOM_MAX_DAYS) {
        return { ok: false, field: 'to', message: 'choose at most ' + EARNINGS_CUSTOM_MAX_DAYS + ' days' };
      }
      return { ok: true, period: 'custom', start, end };
    }
  }
}

const dayText = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'use a date such as 2026-11-01');

const periodFields = {
  period: z.enum(EARNINGS_PERIODS, { error: 'choose today, 7, 30, 90 or custom' }).default('30'),
  from: dayText.optional(),
  to: dayText.optional(),
};

/** The custom range problem of a query, as the issue to report on the field it is about (null when the period is fine). */
function periodIssue(value: PeriodInput): { path: string[]; message: string } | null {
  const resolved = resolvePeriod(value, new Date());
  return resolved.ok ? null : { path: [resolved.field], message: resolved.message };
}

// ------------------------------------------------------------------------------------------------------ the entry types

export const EARNINGS_ENTRY_TYPES = ['cod_commission', 'card_sale', 'card_commission', 'reversal'] as const;
export type EarningsEntryType = (typeof EARNINGS_ENTRY_TYPES)[number];

export const EARNINGS_PAGE_DEFAULT_LIMIT = 20;
export const EARNINGS_PAGE_MAX_LIMIT = 50;

/** GET /api/stores/:id/earnings?period=&from=&to=&page=&limit=&type= */
export const earningsQuerySchema = z
  .object({
    ...periodFields,
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(EARNINGS_PAGE_MAX_LIMIT).default(EARNINGS_PAGE_DEFAULT_LIMIT),
    type: z.enum(EARNINGS_ENTRY_TYPES, { error: 'choose a ledger entry type' }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = periodIssue(value);
    if (issue) context.addIssue({ code: 'custom', ...issue });
  });
export type EarningsQuery = z.output<typeof earningsQuerySchema>;

export interface EarningsEntryRow {
  id: string;
  type: EarningsEntryType;
  reversesType: 'cod_commission' | 'card_sale' | 'card_commission' | null;
  orderId: string;
  /** The shopper-facing order number (ORD-...), or null when the order could not be found. */
  orderNumber: string | null;
  /** Signed whole rupees: what this row did to the seller's balance with the platform. */
  amount: number;
  baseAmount: number;
  rate: number;
  settled: boolean;
  createdAt: string;
}

export interface EarningsPayoutRow {
  id: string;
  amount: number;
  method: 'bank' | 'jazzcash' | 'easypaisa';
  reference: string;
  status: PayoutStatusValue;
  createdAt: string;
}

export interface EarningsResponse {
  period: { key: EarningsPeriod; from: string; to: string; start: string; end: string };
  /** Of the period, from the ledger. sales is the net item subtotal of commission entries; net = sales - commission. */
  summary: { sales: number; commission: number; net: number };
  /** All time. balance is what is not yet paid out (negative: the seller owes the platform). */
  allTime: { balance: number; totalPaidOut: number };
  entries: { docs: EarningsEntryRow[]; page: number; limit: number; totalDocs: number; totalPages: number };
  payouts: EarningsPayoutRow[];
}

// -------------------------------------------------------------------------------------------------------- payout requests

const payoutMethodSchema = z.enum(PAYOUT_METHODS, { error: 'choose bank, jazzcash or easypaisa' });
const noHtml = (value: string): boolean => !containsHtmlTag(value);

export const payoutReferenceSchema = z
  .string()
  .trim()
  .min(1, 'enter the transfer reference')
  .max(PAYOUT_REFERENCE_MAX, 'at most ' + PAYOUT_REFERENCE_MAX + ' characters')
  .refine(noHtml, 'use plain text: HTML tags are not allowed');

export const payoutNoteSchema = z
  .string()
  .trim()
  .max(PAYOUT_NOTE_MAX, 'at most ' + PAYOUT_NOTE_MAX + ' characters')
  .refine(noHtml, 'use plain text: HTML tags are not allowed')
  .nullable()
  .optional();

/** POST /api/admin/payouts (and the signed seller-backend twin): pay a store its whole balance. */
export const createPayoutRequestSchema = z
  .object({
    storeId: objectIdSchema,
    /** The balance the admin saw. It must still be the balance when the payout is made. */
    expectedBalance: z.number().int('whole rupees only').min(1, 'there is nothing to pay'),
    method: payoutMethodSchema,
    reference: payoutReferenceSchema,
    note: payoutNoteSchema,
  })
  .strict();
export type CreatePayoutRequest = z.output<typeof createPayoutRequestSchema>;

export const voidPayoutRequestSchema = z.object({ payoutId: objectIdSchema, reason: moderationReasonSchema }).strict();
export type VoidPayoutRequest = z.output<typeof voidPayoutRequestSchema>;

/** The idempotent "finish or release" step for a payout left in pending_settle. */
export const finishPayoutRequestSchema = z.object({ payoutId: objectIdSchema }).strict();
export type FinishPayoutRequest = z.output<typeof finishPayoutRequestSchema>;

/** The admin asks for a store's full payout account (audited every time). */
export const payoutDetailsRequestSchema = z.object({ storeId: objectIdSchema }).strict();
export type PayoutDetailsRequest = z.output<typeof payoutDetailsRequestSchema>;

export const payoutBalanceListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(PAYOUT_LIST_MAX_LIMIT).default(PAYOUT_LIST_DEFAULT_LIMIT),
    q: z.string().trim().max(PAYOUT_SEARCH_MAX_LENGTH).optional(),
  })
  .strict();
export type PayoutBalanceListQuery = z.output<typeof payoutBalanceListQuerySchema>;

export const payoutListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(PAYOUT_LIST_MAX_LIMIT).default(PAYOUT_LIST_DEFAULT_LIMIT),
    storeId: objectIdSchema.optional(),
    status: z.enum(PAYOUT_STATUS_VALUES).optional(),
  })
  .strict();
export type PayoutListQuery = z.output<typeof payoutListQuerySchema>;

/** The commission report of one store and period (admin). */
export const commissionReportQuerySchema = z
  .object({ storeId: objectIdSchema, ...periodFields })
  .strict()
  .superRefine((value, context) => {
    const issue = periodIssue(value);
    if (issue) context.addIssue({ code: 'custom', ...issue });
  });
export type CommissionReportQuery = z.output<typeof commissionReportQuerySchema>;

// ------------------------------------------------------------------------------------------------------ payout answers

const iso = z.string();

export const payoutDetailsSnapshotSchema = z.object({
  method: z.enum(PAYOUT_METHODS),
  accountTitle: z.string(),
  last4: z.string(),
  bankName: z.string().nullable(),
});

export const payoutRowSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  storeName: z.string().nullable(),
  amount: z.number().int(),
  method: z.enum(PAYOUT_METHODS),
  reference: z.string(),
  note: z.string().nullable(),
  status: z.enum(PAYOUT_STATUS_VALUES),
  cutoff: iso,
  entryCount: z.number().int(),
  details: payoutDetailsSnapshotSchema,
  createdBy: z.string(),
  paidAt: iso.nullable(),
  failedReason: z.string().nullable(),
  voidedAt: iso.nullable(),
  voidedBy: z.string().nullable(),
  voidReason: z.string().nullable(),
  createdAt: iso,
});
export type PayoutRow = z.output<typeof payoutRowSchema>;

export const payoutListSchema = z.object({
  docs: z.array(payoutRowSchema),
  page: z.number().int(),
  limit: z.number().int(),
  totalDocs: z.number().int(),
  totalPages: z.number().int(),
});
export type PayoutList = z.output<typeof payoutListSchema>;

export const payoutBalanceRowSchema = z.object({
  storeId: z.string().min(1),
  storeName: z.string(),
  /** Signed whole rupees; the sum of the unsettled entries. */
  balance: z.number().int(),
  unsettledEntries: z.number().int(),
  payoutMethod: z.enum(PAYOUT_METHODS).nullable(),
  payoutLast4: z.string().nullable(),
  hasPayoutDetails: z.boolean(),
  emailVerified: z.boolean(),
  /** A payout of this store is stuck in pending_settle: resolve it from the history first. */
  hasPendingPayout: z.boolean(),
});
export type PayoutBalanceRow = z.output<typeof payoutBalanceRowSchema>;

export const payoutBalanceListSchema = z.object({
  docs: z.array(payoutBalanceRowSchema),
  page: z.number().int(),
  limit: z.number().int(),
  totalDocs: z.number().int(),
  totalPages: z.number().int(),
});
export type PayoutBalanceList = z.output<typeof payoutBalanceListSchema>;

/** What the admin needs to send the money. The only place the full account number leaves the seller backend. */
export const payoutFullDetailsSchema = z.object({
  storeId: z.string().min(1),
  method: z.enum(PAYOUT_METHODS),
  accountTitle: z.string(),
  accountNumber: z.string(),
  bankName: z.string().nullable(),
});
export type PayoutFullDetails = z.output<typeof payoutFullDetailsSchema>;

export const commissionReportSchema = z.object({
  storeId: z.string().min(1),
  storeName: z.string(),
  period: z.object({ key: z.enum(EARNINGS_PERIODS), from: z.string(), to: z.string() }),
  /** Net commission the platform earned in the period (reversals subtract). */
  commissionEarned: z.number().int(),
  /** Net item subtotal the commission was taken on. */
  sales: z.number().int(),
  /** Orders whose commission was taken in the period, less the commission reversals of the period (the same netting as sales). */
  ordersCount: z.number().int(),
  /** The store's balance now (all time, not yet paid out). */
  balance: z.number().int(),
});
export type CommissionReport = z.output<typeof commissionReportSchema>;
