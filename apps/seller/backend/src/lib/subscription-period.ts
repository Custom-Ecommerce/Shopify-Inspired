/**
 * Sprint 6 EP-14 (S6-B4, D-118): the period a confirmed manual payment buys. Pure: no database, no clock (the caller passes `now`).
 *
 * A period is ONE calendar month, worked out in UTC so a server's time zone never moves a date:
 *
 *   - the first payment (no subscription, a trial, grace, expired, cancelled-and-over) starts the period at the CONFIRM date `now`;
 *   - a renewal of the SAME plan while it is still active (or cancelled with the period still running) extends from the current period end, so
 *     the seller loses no day they already paid for and the billing day stays where it was;
 *   - a payment for a DIFFERENT plan while another is running starts the new plan at `now` (the unused days of the old plan are not carried over;
 *     the simplest safe rule: there is no proration in this version);
 *   - the month end is clamped: Jan 31 + 1 month = Feb 28 (Feb 29 in a leap year), Mar 31 + 1 = Apr 30. A renewal then starts from that date,
 *     so a plan bought on Jan 31 renews on Feb 28, Mar 28 and so on (no anchor day is stored: the simplest safe option).
 *
 * The time of day of the start is kept, so a period always ends at the same time of day it began.
 */

export const DAY_MS = 86_400_000;

/** Adds whole calendar months in UTC, clamping the day to the length of the target month. `months` may be 0 or more. */
export function addMonthsUtc(from: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 0) throw new RangeError('months must be a whole number of 0 or more');
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

/** Adds whole days (24 hours each, UTC has no daylight saving). */
export function addDaysUtc(from: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 0) throw new RangeError('days must be a whole number of 0 or more');
  return new Date(from.getTime() + days * DAY_MS);
}

/** The end of the grace that follows a period: the period end plus the platform graceDays. */
export function graceEndFor(periodEnd: Date, graceDays: number): Date {
  return addDaysUtc(periodEnd, graceDays);
}

/** The end of a trial that starts at `start` and lasts the platform trialDays, or null when there is no trial (0 days). */
export function trialEndFor(start: Date, trialDays: number): Date | null {
  return trialDays > 0 ? addDaysUtc(start, trialDays) : null;
}

export interface CurrentSubscriptionForPeriod {
  planKey: string;
  status: string;
  currentPeriodEnd?: Date | string | null;
}

export interface PaymentPeriodInput {
  /** The confirm moment. */
  now: Date;
  /** The plan the payment is for. */
  planKey: string;
  /** The seller's subscription before this payment, or null. */
  current?: CurrentSubscriptionForPeriod | null;
  /** Months bought. Always 1 in this version. */
  months?: number;
}

export interface PaymentPeriod {
  periodStart: Date;
  periodEnd: Date;
  /** True when the period continues the running one (a renewal); false when it starts at `now`. */
  extended: boolean;
}

const asDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Pure: the period a confirmed payment buys. See the file comment for the rules. */
export function computePaymentPeriod(input: PaymentPeriodInput): PaymentPeriod {
  const months = input.months ?? 1;
  const end = asDate(input.current?.currentPeriodEnd);
  const running =
    input.current !== null &&
    input.current !== undefined &&
    input.current.planKey === input.planKey &&
    (input.current.status === 'active' || input.current.status === 'cancelled') &&
    end !== null &&
    end.getTime() > input.now.getTime();
  const periodStart = running ? (end as Date) : input.now;
  return { periodStart, periodEnd: addMonthsUtc(periodStart, months), extended: running };
}
