import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARNINGS_CUSTOM_MAX_DAYS,
  commissionReportQuerySchema,
  createPayoutRequestSchema,
  earningsQuerySchema,
  finishPayoutRequestSchema,
  karachiDayLabel,
  karachiDayStart,
  parseKarachiDay,
  payoutBalanceListQuerySchema,
  payoutDetailsRequestSchema,
  payoutListQuerySchema,
  resolvePeriod,
  voidPayoutRequestSchema,
} from '../src/index';

// Sprint 4 EP-05.US03, US04, US06: periods on Asia/Karachi day boundaries, and the payout request shapes. Pure: no I/O.

const STORE = '65a000000000000000000011';
const PAYOUT = '65a000000000000000000021';
const NOW = new Date('2026-11-15T10:00:00.000Z'); // 15:00 in Karachi

const iso = (date: Date): string => date.toISOString();

// -------------------------------------------------------------------------------------------------------- Karachi days

test('a Karachi day starts at 19:00 UTC of the day before, with no daylight saving', () => {
  assert.equal(iso(karachiDayStart(new Date('2026-11-15T10:00:00.000Z'))), '2026-11-14T19:00:00.000Z');
  assert.equal(iso(karachiDayStart(new Date('2026-11-14T19:00:00.000Z'))), '2026-11-14T19:00:00.000Z', 'the first millisecond is its own day');
  assert.equal(iso(karachiDayStart(new Date('2026-11-14T18:59:59.999Z'))), '2026-11-13T19:00:00.000Z', 'one millisecond earlier is the day before');
  assert.equal(iso(karachiDayStart(new Date('2026-07-01T00:00:00.000Z'))), '2026-06-30T19:00:00.000Z', 'summer is the same offset');
  assert.equal(karachiDayLabel(new Date('2026-11-14T19:00:00.000Z')), '2026-11-15');
  assert.equal(karachiDayLabel(new Date('2026-11-15T18:59:59.999Z')), '2026-11-15');
});

test('a day text is a real Karachi day or nothing', () => {
  assert.equal(iso(parseKarachiDay('2026-11-15')!), '2026-11-14T19:00:00.000Z');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-11-1', '15-11-2026', '2026-11-15T00:00:00Z', '', ' 2026-11-15']) assert.equal(parseKarachiDay(bad), null, bad);
  assert.ok(parseKarachiDay('2028-02-29'), 'a leap day');
  assert.equal(parseKarachiDay('2027-02-29'), null);
});

test('today is [start of the Karachi day, start of the next): the start is in, the end is out', () => {
  const period = resolvePeriod({ period: 'today' }, NOW);
  assert.ok(period.ok);
  assert.deepEqual([iso(period.start), iso(period.end)], ['2026-11-14T19:00:00.000Z', '2026-11-15T19:00:00.000Z']);
  // Exactly midnight Karachi: that instant is already the next day.
  const midnight = resolvePeriod({ period: 'today' }, new Date('2026-11-15T19:00:00.000Z'));
  assert.ok(midnight.ok);
  assert.equal(iso(midnight.start), '2026-11-15T19:00:00.000Z');
});

test('7, 30 and 90 are that many whole Karachi days ending with today', () => {
  for (const [key, from] of [['7', '2026-11-09'], ['30', '2026-10-17'], ['90', '2026-08-18']] as const) {
    const period = resolvePeriod({ period: key }, NOW);
    assert.ok(period.ok, key);
    assert.equal(karachiDayLabel(period.start), from, key);
    assert.equal(iso(period.end), '2026-11-15T19:00:00.000Z', key);
    assert.equal((period.end.getTime() - period.start.getTime()) / 86_400_000, Number(key), key);
  }
});

test('a custom range includes both named days; its end is the start of the day after the last one', () => {
  const one = resolvePeriod({ period: 'custom', from: '2026-11-15', to: '2026-11-15' }, NOW);
  assert.ok(one.ok);
  assert.deepEqual([iso(one.start), iso(one.end)], ['2026-11-14T19:00:00.000Z', '2026-11-15T19:00:00.000Z']);
  const many = resolvePeriod({ period: 'custom', from: '2026-11-01', to: '2026-11-30' }, NOW);
  assert.ok(many.ok);
  assert.equal((many.end.getTime() - many.start.getTime()) / 86_400_000, 30);
  // It does not depend on today's date.
  const later = resolvePeriod({ period: 'custom', from: '2026-11-01', to: '2026-11-30' }, new Date('2030-01-01T00:00:00Z'));
  assert.ok(later.ok);
  assert.equal(iso(later.start), iso(many.start));
});

test('a custom range names the field that is wrong', () => {
  const problem = (input: Parameters<typeof resolvePeriod>[0]) => {
    const result = resolvePeriod(input, NOW);
    assert.equal(result.ok, false);
    return result.ok ? null : result.field;
  };
  assert.equal(problem({ period: 'custom' }), 'from');
  assert.equal(problem({ period: 'custom', from: '2026-11-01' }), 'to');
  assert.equal(problem({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }), 'from');
  assert.equal(problem({ period: 'custom', from: '2026-11-01', to: 'tomorrow' }), 'to');
  assert.equal(problem({ period: 'custom', from: '2026-11-10', to: '2026-11-09' }), 'to');
  const tooLong = resolvePeriod({ period: 'custom', from: '2025-11-15', to: '2026-11-16' }, NOW);
  assert.equal(tooLong.ok, false, 'a year and a day is too long');
  const exact = resolvePeriod({ period: 'custom', from: '2025-11-15', to: '2026-11-15' }, NOW);
  assert.ok(exact.ok, EARNINGS_CUSTOM_MAX_DAYS + ' days are allowed');
});

// ---------------------------------------------------------------------------------------------------- the query shapes

test('the earnings query defaults to 30 days, page 1, and refuses unknown keys, types and sizes', () => {
  assert.deepEqual(earningsQuerySchema.parse({}), { period: '30', page: 1, limit: 20 });
  assert.deepEqual(earningsQuerySchema.parse({ period: 'today', page: '3', limit: '50', type: 'reversal' }), { period: 'today', page: 3, limit: 50, type: 'reversal' });
  const field = (input: unknown): string | undefined => {
    const result = earningsQuerySchema.safeParse(input);
    assert.equal(result.success, false);
    return result.success ? undefined : String(result.error.issues[0]!.path[0] ?? (result.error.issues[0] as { keys?: string[] }).keys?.[0]);
  };
  assert.equal(field({ period: 'custom' }), 'from');
  assert.equal(field({ period: '14' }), 'period');
  assert.equal(field({ type: 'refund' }), 'type');
  assert.equal(field({ limit: '51' }), 'limit');
  assert.equal(field({ page: '0' }), 'page');
  assert.equal(field({ storeId: STORE }), 'storeId');
});

test('the report query needs a store and a valid period', () => {
  assert.deepEqual(commissionReportQuerySchema.parse({ storeId: STORE }), { storeId: STORE, period: '30' });
  assert.equal(commissionReportQuerySchema.safeParse({ period: '7' }).success, false);
  assert.equal(commissionReportQuerySchema.safeParse({ storeId: 'x', period: '7' }).success, false);
  assert.equal(commissionReportQuerySchema.safeParse({ storeId: STORE, period: 'custom', from: '2026-11-02', to: '2026-11-01' }).success, false);
  assert.equal(commissionReportQuerySchema.safeParse({ storeId: STORE, period: 'custom', from: '2026-11-01', to: '2026-11-02' }).success, true);
});

test('the list queries are paged and refuse what is not a filter', () => {
  assert.deepEqual(payoutBalanceListQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.deepEqual(payoutListQuerySchema.parse({ status: 'pending_settle', storeId: STORE }), { page: 1, limit: 20, status: 'pending_settle', storeId: STORE });
  assert.equal(payoutListQuerySchema.safeParse({ status: 'done' }).success, false);
  assert.equal(payoutBalanceListQuerySchema.safeParse({ limit: '51' }).success, false);
  assert.equal(payoutBalanceListQuerySchema.safeParse({ q: 'x'.repeat(81) }).success, false);
  assert.equal(payoutListQuerySchema.safeParse({ sort: 'amount' }).success, false);
});

// ------------------------------------------------------------------------------------------------- the payout requests

const valid = { storeId: STORE, expectedBalance: 12500, method: 'jazzcash', reference: ' JC-778812 ', note: 'March payout' };

test('a payout request is whole rupees above zero, with a method and a reference', () => {
  const parsed = createPayoutRequestSchema.parse(valid);
  assert.deepEqual(parsed, { storeId: STORE, expectedBalance: 12500, method: 'jazzcash', reference: 'JC-778812', note: 'March payout' });
  assert.equal(createPayoutRequestSchema.parse({ ...valid, note: undefined }).note, undefined);
  assert.equal(createPayoutRequestSchema.parse({ ...valid, note: null }).note, null);
  for (const bad of [
    { ...valid, expectedBalance: 0 },
    { ...valid, expectedBalance: -5 },
    { ...valid, expectedBalance: 10.5 },
    { ...valid, expectedBalance: '12500' },
    { ...valid, method: 'cheque' },
    { ...valid, reference: '   ' },
    { ...valid, reference: 'x'.repeat(101) },
    { ...valid, reference: '<script>x</script>' },
    { ...valid, note: 'y'.repeat(501) },
    { ...valid, storeId: 'nope' },
    { ...valid, amount: 5 },
  ]) {
    assert.equal(createPayoutRequestSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test('a void needs a reason of 3 to 500 characters; finish and details take an id only', () => {
  assert.equal(voidPayoutRequestSchema.safeParse({ payoutId: PAYOUT, reason: 'Sent to the wrong account' }).success, true);
  assert.equal(voidPayoutRequestSchema.safeParse({ payoutId: PAYOUT, reason: 'no' }).success, false);
  assert.equal(voidPayoutRequestSchema.safeParse({ payoutId: PAYOUT, reason: 'x'.repeat(501) }).success, false);
  assert.equal(voidPayoutRequestSchema.safeParse({ payoutId: PAYOUT }).success, false);
  assert.equal(finishPayoutRequestSchema.safeParse({ payoutId: PAYOUT }).success, true);
  assert.equal(finishPayoutRequestSchema.safeParse({ payoutId: PAYOUT, force: true }).success, false);
  assert.equal(payoutDetailsRequestSchema.safeParse({ storeId: STORE }).success, true);
  assert.equal(payoutDetailsRequestSchema.safeParse({ storeId: STORE, reveal: true }).success, false);
});
