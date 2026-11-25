import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDaysUtc, addMonthsUtc, computePaymentPeriod, graceEndFor, trialEndFor } from '@/lib/subscription-period';

// Sprint 6 (S6-B4, D-118): the period of a confirmed manual payment. Pure functions; edge dates and leap years.

const at = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString();

test('one month later keeps the day and the time of day', () => {
  assert.equal(iso(addMonthsUtc(at('2026-11-20T10:15:30.250Z'), 1)), '2026-12-20T10:15:30.250Z');
  assert.equal(iso(addMonthsUtc(at('2026-01-15T00:00:00Z'), 0)), '2026-01-15T00:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2026-01-15T23:59:59Z'), 3)), '2026-04-15T23:59:59.000Z');
});

test('the month end is clamped: Jan 31 + 1 month is Feb 28, and in a leap year Feb 29', () => {
  assert.equal(iso(addMonthsUtc(at('2026-01-31T09:00:00Z'), 1)), '2026-02-28T09:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2028-01-31T09:00:00Z'), 1)), '2028-02-29T09:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2026-03-31T09:00:00Z'), 1)), '2026-04-30T09:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2026-05-31T09:00:00Z'), 1)), '2026-06-30T09:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2026-08-30T09:00:00Z'), 6)), '2027-02-28T09:00:00.000Z');
});

test('leap day itself: Feb 29 + 1 month is Mar 29; + 12 months is Feb 28 of the next year', () => {
  assert.equal(iso(addMonthsUtc(at('2028-02-29T12:00:00Z'), 1)), '2028-03-29T12:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2028-02-29T12:00:00Z'), 12)), '2029-02-28T12:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2028-02-29T12:00:00Z'), 48)), '2032-02-29T12:00:00.000Z');
});

test('the year rolls over: Dec + 1 month is January of the next year, Dec 31 + 2 months is Feb 28', () => {
  assert.equal(iso(addMonthsUtc(at('2026-12-15T08:00:00Z'), 1)), '2027-01-15T08:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2026-12-31T08:00:00Z'), 2)), '2027-02-28T08:00:00.000Z');
  assert.equal(iso(addMonthsUtc(at('2027-12-31T08:00:00Z'), 2)), '2028-02-29T08:00:00.000Z');
});

test('a negative or fractional month count is refused', () => {
  assert.throws(() => addMonthsUtc(at('2026-01-01T00:00:00Z'), -1), RangeError);
  assert.throws(() => addMonthsUtc(at('2026-01-01T00:00:00Z'), 1.5), RangeError);
  assert.throws(() => addDaysUtc(at('2026-01-01T00:00:00Z'), -1), RangeError);
  assert.throws(() => addDaysUtc(at('2026-01-01T00:00:00Z'), 0.5), RangeError);
});

test('days are added across a month end and a leap day', () => {
  assert.equal(iso(addDaysUtc(at('2026-02-25T00:00:00Z'), 7)), '2026-03-04T00:00:00.000Z');
  assert.equal(iso(addDaysUtc(at('2028-02-25T00:00:00Z'), 7)), '2028-03-03T00:00:00.000Z');
  assert.equal(iso(addDaysUtc(at('2026-06-01T00:00:00Z'), 0)), '2026-06-01T00:00:00.000Z');
});

test('grace and trial come from the platform settings: grace follows the period end; no trial days means no trial', () => {
  assert.equal(iso(graceEndFor(at('2026-12-20T10:00:00Z'), 7)), '2026-12-27T10:00:00.000Z');
  assert.equal(iso(graceEndFor(at('2026-12-20T10:00:00Z'), 0)), '2026-12-20T10:00:00.000Z');
  assert.equal(iso(trialEndFor(at('2026-11-20T00:00:00Z'), 14)!), '2026-12-04T00:00:00.000Z');
  assert.equal(trialEndFor(at('2026-11-20T00:00:00Z'), 0), null);
});

test('the first payment starts at the confirm date', () => {
  const now = at('2026-11-20T10:00:00Z');
  const period = computePaymentPeriod({ now, planKey: 'growth', current: null });
  assert.deepEqual([iso(period.periodStart), iso(period.periodEnd), period.extended], ['2026-11-20T10:00:00.000Z', '2026-12-20T10:00:00.000Z', false]);
  assert.equal(computePaymentPeriod({ now, planKey: 'growth' }).extended, false, 'no subscription argument at all');
});

test('a renewal while still active extends from the current period end, not from the confirm date', () => {
  const now = at('2026-11-20T10:00:00Z');
  const current = { planKey: 'growth', status: 'active', currentPeriodEnd: at('2026-11-25T06:00:00Z') };
  const period = computePaymentPeriod({ now, planKey: 'growth', current });
  assert.deepEqual([iso(period.periodStart), iso(period.periodEnd), period.extended], ['2026-11-25T06:00:00.000Z', '2026-12-25T06:00:00.000Z', true]);
  assert.equal(iso(computePaymentPeriod({ now, planKey: 'growth', current: { ...current, currentPeriodEnd: '2026-11-25T06:00:00.000Z' } }).periodStart), '2026-11-25T06:00:00.000Z', 'a stored ISO string works too');
});

test('a renewal on Jan 31 of a running period lands on the last day of February', () => {
  const now = at('2026-01-20T00:00:00Z');
  const period = computePaymentPeriod({ now, planKey: 'growth', current: { planKey: 'growth', status: 'active', currentPeriodEnd: at('2026-01-31T00:00:00Z') } });
  assert.equal(iso(period.periodEnd), '2026-02-28T00:00:00.000Z');
  const leap = computePaymentPeriod({ now: at('2028-01-20T00:00:00Z'), planKey: 'growth', current: { planKey: 'growth', status: 'active', currentPeriodEnd: at('2028-01-31T00:00:00Z') } });
  assert.equal(iso(leap.periodEnd), '2028-02-29T00:00:00.000Z');
});

test('a cancelled subscription whose period still runs is renewed from its end too', () => {
  const period = computePaymentPeriod({ now: at('2026-11-20T00:00:00Z'), planKey: 'growth', current: { planKey: 'growth', status: 'cancelled', currentPeriodEnd: at('2026-12-01T00:00:00Z') } });
  assert.deepEqual([iso(period.periodStart), period.extended], ['2026-12-01T00:00:00.000Z', true]);
});

test('an ended period starts again at the confirm date, whatever its stored status: grace, expired, active-but-past, cancelled-but-past', () => {
  const now = at('2026-11-20T10:00:00Z');
  for (const status of ['grace', 'expired', 'active', 'cancelled']) {
    const period = computePaymentPeriod({ now, planKey: 'growth', current: { planKey: 'growth', status, currentPeriodEnd: at(status === 'grace' || status === 'expired' ? '2026-11-25T00:00:00Z' : '2026-11-15T00:00:00Z') } });
    assert.equal(iso(period.periodStart), '2026-11-20T10:00:00.000Z', status);
    assert.equal(period.extended, false, status);
  }
  assert.equal(computePaymentPeriod({ now, planKey: 'growth', current: { planKey: 'growth', status: 'active', currentPeriodEnd: now } }).extended, false, 'ending exactly now is over');
});

test('a trial, or a subscription with no end date, starts the paid period at the confirm date', () => {
  const now = at('2026-11-20T10:00:00Z');
  assert.equal(computePaymentPeriod({ now, planKey: 'growth', current: { planKey: 'growth', status: 'trial', currentPeriodEnd: at('2026-12-01T00:00:00Z') } }).extended, false);
  assert.equal(computePaymentPeriod({ now, planKey: 'growth', current: { planKey: 'growth', status: 'active', currentPeriodEnd: null } }).extended, false);
  assert.equal(computePaymentPeriod({ now, planKey: 'growth', current: { planKey: 'growth', status: 'active', currentPeriodEnd: 'not a date' } }).extended, false);
});

test('a payment for a different plan starts at the confirm date: no days are carried over', () => {
  const now = at('2026-11-20T10:00:00Z');
  const period = computePaymentPeriod({ now, planKey: 'pro', current: { planKey: 'growth', status: 'active', currentPeriodEnd: at('2026-12-15T00:00:00Z') } });
  assert.deepEqual([iso(period.periodStart), iso(period.periodEnd), period.extended], ['2026-11-20T10:00:00.000Z', '2026-12-20T10:00:00.000Z', false]);
});

test('the period is a month, and more months can be asked for', () => {
  const now = at('2026-11-20T10:00:00Z');
  assert.equal(iso(computePaymentPeriod({ now, planKey: 'growth', months: 3 }).periodEnd), '2027-02-20T10:00:00.000Z');
});
