import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { buildCommissionReport } from '@/lib/commission-report';
import { commissionReportQuerySchema, earningsQuerySchema } from '@/lib/contracts';
import { buildEarnings } from '@/lib/earnings';
import { HttpError } from '@/lib/http';
import { assertCan, signSession } from '@/lib/services';
import { ADMIN, OWNER_A, OWNER_B, STORE_A, STORE_B, ORDER_1, ORDER_2, installLedgerWorld, type Row, type World } from './helpers/ledger-world';

// Sprint 4 EP-05.US04, US06 (D-090): the seller's earnings and the admin's commission report, from the ledger only.
// The ledger is in memory (test/helpers/ledger-world.ts); the aggregation code under test is the real one.

const AUTH_SECRET = 'x'.repeat(40);
const MOD_SECRET = 'm'.repeat(40);
/** 15:00 on 15 November in Karachi. Karachi "today" is [2026-11-14T19:00:00Z, 2026-11-15T19:00:00Z). */
const NOW = new Date('2026-11-15T10:00:00.000Z');

let world: World;
let tokenA = '';
let tokenB = '';
let tokenAdmin = '';
let earningsGET: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let reportGET: (request: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  tokenA = await signSession({ sub: OWNER_A, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  tokenB = await signSession({ sub: OWNER_B, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  tokenAdmin = await signSession({ sub: ADMIN, role: 'admin' }, AUTH_SECRET, SELLER_AUDIENCE);
  earningsGET = (await import('../src/app/api/stores/[id]/earnings/route')).GET;
  reportGET = (await import('../src/app/api/internal/commission/report/route')).GET;
});

beforeEach(() => {
  world = installLedgerWorld();
  process.env.MODERATION_API_SECRET = MOD_SECRET;
});

afterEach(() => {
  delete process.env.MODERATION_API_SECRET;
  world.restore();
});

const at = (iso: string): Date => new Date(iso);

/**
 * Store A's ledger in November. cod commission of order 1 (80 on 2,000), later reversed; a card order 2 (sale 2,250, commission
 * 60 on 1,500), whose sale is also reversed. All still unsettled.
 */
function ledger(): Record<string, Row> {
  return {
    cod: world.entry({ type: 'cod_commission', order: ORDER_1, balanceEffect: -80, baseAmount: 2000, createdAt: at('2026-11-10T08:00:00Z') }),
    sale: world.entry({ type: 'card_sale', order: ORDER_2, balanceEffect: 2250, baseAmount: 2250, createdAt: at('2026-11-11T08:00:00Z') }),
    fee: world.entry({ type: 'card_commission', order: ORDER_2, balanceEffect: -60, baseAmount: 1500, createdAt: at('2026-11-11T08:00:01Z') }),
    undoCod: world.entry({ type: 'reversal', reversesType: 'cod_commission', order: ORDER_1, balanceEffect: 80, baseAmount: 2000, createdAt: at('2026-11-12T08:00:00Z') }),
    undoSale: world.entry({ type: 'reversal', reversesType: 'card_sale', order: ORDER_2, balanceEffect: -2250, baseAmount: 2250, createdAt: at('2026-11-12T08:00:01Z') }),
  };
}

const query = (raw: Record<string, string> = {}) => earningsQuerySchema.parse({ period: '30', ...raw });
const get = (id: string, token: string | null, search = ''): NextRequest =>
  new NextRequest('http://seller.test/api/stores/' + id + '/earnings' + search, token === null ? {} : { headers: { authorization: 'Bearer ' + token } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// -------------------------------------------------------------------------------------------------------------- totals

test('the summary is the sum of the period\'s commission entries: sales net of reversals, commission net, delivery and card sales left out', async () => {
  ledger();
  world.entry({ store: STORE_B, type: 'cod_commission', balanceEffect: -999, baseAmount: 99999, createdAt: at('2026-11-10T08:00:00Z') });
  const result = await buildEarnings(STORE_A, query(), NOW);

  // Independent sums, straight from the rows.
  const rows = world.entries.filter((e) => e.store === STORE_A && (e.type === 'cod_commission' || e.type === 'card_commission' || (e.type === 'reversal' && e.reversesType !== 'card_sale')));
  const sales = rows.reduce((total, e) => total + (e.type === 'reversal' ? -e.baseAmount : e.baseAmount), 0);
  const commission = -rows.reduce((total, e) => total + e.balanceEffect, 0);
  assert.deepEqual([sales, commission], [1500, 60]);
  assert.deepEqual(result.summary, { sales, commission, net: sales - commission });
  assert.deepEqual(result.summary, { sales: 1500, commission: 60, net: 1440 });
  assert.equal(result.entries.totalDocs, 5, 'the ledger list shows every row of the period, card sales too');
});

test('all time: the balance is what is not paid out, and the paid out total counts paid payouts only', async () => {
  const rows = ledger();
  rows.sale!.settledAt = at('2026-11-13T00:00:00Z');
  rows.sale!.payoutId = 'a0a0a0a0a0a0a0a0a0a0a0a0';
  let counter = 0;
  const payout = (status: string, amount: number, createdAt: string): Row => ({
    _id: 'c0c0c0c0c0c0c0c0c0c0c0' + String((counter += 1)).padStart(2, '0'),
    store: STORE_A,
    amount,
    method: 'jazzcash',
    reference: 'REF-' + status,
    status,
    createdBy: ADMIN,
    createdAt: at(createdAt),
  });
  world.payouts.push(payout('paid', 1000, '2026-11-13T00:00:00Z'), payout('voided', 500, '2026-11-13T01:00:00Z'), payout('pending_settle', 700, '2026-11-13T02:00:00Z'), payout('failed', 300, '2026-11-13T03:00:00Z'));
  world.payouts.push({ ...payout('paid', 9999, '2026-11-13T04:00:00Z'), store: STORE_B });

  const result = await buildEarnings(STORE_A, query(), NOW);
  assert.deepEqual(result.allTime, { balance: -80 - 60 + 80 - 2250, totalPaidOut: 1000 });
  assert.deepEqual(result.payouts.map((p) => p.status), ['voided', 'paid'], 'a seller sees paid and cancelled payouts, newest first');
  assert.deepEqual(Object.keys(result.payouts[0]!).sort(), ['amount', 'createdAt', 'id', 'method', 'reference', 'status']);
});

test('the entry list is paged, newest first, filtered by type, and looks up order numbers for the page only', async () => {
  ledger();
  world.orderLookups.length = 0;
  const first = await buildEarnings(STORE_A, query({ limit: '2' }), NOW);
  assert.equal(first.entries.docs.length, 2);
  assert.deepEqual([first.entries.page, first.entries.limit, first.entries.totalDocs, first.entries.totalPages], [1, 2, 5, 3]);
  assert.deepEqual(first.entries.docs.map((d) => d.type), ['reversal', 'reversal']);
  assert.equal(world.orderLookups.length, 1);
  assert.ok(world.orderLookups[0]!.length <= 2, 'only the two orders of this page were looked up');
  assert.equal(first.entries.docs[0]!.orderNumber, 'ORD-BBBB2222');
  assert.equal(first.entries.docs[0]!.amount, -2250);
  assert.equal(first.entries.docs[0]!.settled, false);

  const last = await buildEarnings(STORE_A, query({ limit: '2', page: '3' }), NOW);
  assert.deepEqual(last.entries.docs.map((d) => d.type), ['cod_commission']);

  const reversals = await buildEarnings(STORE_A, query({ type: 'reversal' }), NOW);
  assert.deepEqual(reversals.entries.docs.map((d) => d.reversesType).sort(), ['card_sale', 'cod_commission']);
  assert.equal(reversals.entries.totalDocs, 2);
  assert.deepEqual(reversals.summary, { sales: 1500, commission: 60, net: 1440 }, 'the type filter narrows the list, never the totals');

  world.entry({ type: 'cod_commission', order: '65a0000000000000000a0099', createdAt: at('2026-11-13T00:00:00Z') });
  const unknownOrder = await buildEarnings(STORE_A, query({ type: 'cod_commission' }), NOW);
  assert.ok(unknownOrder.entries.docs.some((d) => d.orderNumber === null), 'an order that cannot be found has no number, and the row still shows');
});

// ----------------------------------------------------------------------------------------------------- Karachi days

function atEdges(): void {
  for (const iso of ['2026-11-14T18:59:59.999Z', '2026-11-14T19:00:00.000Z', '2026-11-15T18:59:59.999Z', '2026-11-15T19:00:00.000Z']) {
    world.entry({ type: 'cod_commission', balanceEffect: -40, baseAmount: 1000, createdAt: at(iso) });
  }
}

test('today is the Karachi day: its first millisecond is in, the first millisecond of the next day is out', async () => {
  atEdges();
  const today = await buildEarnings(STORE_A, query({ period: 'today' }), NOW);
  assert.equal(today.entries.totalDocs, 2);
  assert.deepEqual(today.summary, { sales: 2000, commission: 80, net: 1920 });
  assert.deepEqual([today.period.from, today.period.to], ['2026-11-15', '2026-11-15']);
  assert.deepEqual([today.period.start, today.period.end], ['2026-11-14T19:00:00.000Z', '2026-11-15T19:00:00.000Z']);
});

test('a custom range includes both named days, from the start of the first to the end of the last', async () => {
  atEdges();
  const one = await buildEarnings(STORE_A, query({ period: 'custom', from: '2026-11-15', to: '2026-11-15' }), NOW);
  assert.equal(one.entries.totalDocs, 2);
  const two = await buildEarnings(STORE_A, query({ period: 'custom', from: '2026-11-14', to: '2026-11-15' }), NOW);
  assert.equal(two.entries.totalDocs, 3, 'the last millisecond of 14 November in Karachi belongs to the 14th');
  assert.deepEqual(two.summary, { sales: 3000, commission: 120, net: 2880 });
  assert.equal(two.period.end, '2026-11-15T19:00:00.000Z');
});

test('7, 30 and 90 days are whole Karachi days ending today', async () => {
  for (const iso of ['2026-11-08T18:59:59.999Z', '2026-11-08T19:00:00.000Z']) world.entry({ type: 'cod_commission', balanceEffect: -40, baseAmount: 1000, createdAt: at(iso) });
  const week = await buildEarnings(STORE_A, query({ period: '7' }), NOW);
  assert.equal(week.entries.totalDocs, 1, 'the day before the seventh is out');
  assert.deepEqual([week.period.from, week.period.to], ['2026-11-09', '2026-11-15']);
  const month = await buildEarnings(STORE_A, query({ period: '30' }), NOW);
  assert.equal(month.entries.totalDocs, 2);
  assert.equal(month.period.from, '2026-10-17');
  assert.equal((await buildEarnings(STORE_A, query({ period: '90' }), NOW)).period.from, '2026-08-18');
});

// ----------------------------------------------------------------------------------------------------------- empty

test('a store with nothing in its ledger answers zeros and empty lists, never an error', async () => {
  const empty = await buildEarnings(STORE_B, query(), NOW);
  assert.deepEqual(empty.summary, { sales: 0, commission: 0, net: 0 });
  assert.deepEqual(empty.allTime, { balance: 0, totalPaidOut: 0 });
  assert.deepEqual(empty.entries, { docs: [], page: 1, limit: 20, totalDocs: 0, totalPages: 0 });
  assert.deepEqual(empty.payouts, []);
  const response = await earningsGET(get(STORE_B, tokenB), params(STORE_B));
  assert.equal(response.status, 200);
  assert.deepEqual(((await response.json()) as { summary: unknown }).summary, { sales: 0, commission: 0, net: 0 });
});

// ----------------------------------------------------------------------------------------------------------- the route

test('a seller reads their own earnings, and only the ones of their own store', async () => {
  ledger();
  world.entry({ store: STORE_B, type: 'cod_commission', balanceEffect: -999, baseAmount: 24975, createdAt: at('2026-11-11T08:00:00Z') });
  // A custom range does not depend on today's date.
  const own = await earningsGET(get(STORE_A, tokenA, '?period=custom&from=2026-11-10&to=2026-11-15'), params(STORE_A));
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'no-store');
  const body = (await own.json()) as { summary: unknown; allTime: unknown; entries: { totalDocs: number } };
  assert.deepEqual(body.summary, { sales: 1500, commission: 60, net: 1440 });
  assert.deepEqual(body.allTime, { balance: -60, totalPaidOut: 0 });
  assert.equal(body.entries.totalDocs, 5, "the other store's row is not in it");
});

test('Seller B cannot read Seller A\'s earnings or payouts, and an admin or a visitor cannot either', async () => {
  ledger();
  world.payouts.push({ _id: 'c0c0c0c0c0c0c0c0c0c0c0c0', store: STORE_A, amount: 1000, method: 'jazzcash', reference: 'SECRET-REF', status: 'paid', createdAt: new Date() });
  const other = await earningsGET(get(STORE_A, tokenB), params(STORE_A));
  assert.equal(other.status, 403);
  assert.equal(JSON.stringify(await other.json()).includes('SECRET-REF'), false);
  assert.equal((await earningsGET(get(STORE_A, tokenAdmin), params(STORE_A))).status, 403);
  assert.equal((await earningsGET(get(STORE_A, null), params(STORE_A))).status, 401);
  assert.equal((await earningsGET(get('not-an-id', tokenA), params('not-an-id'))).status, 404);
  assert.equal((await earningsGET(get('65a0000000000000000fffff', tokenA), params('65a0000000000000000fffff'))).status, 403);
});

test('a bad period, date, page, type or key is a 400 that names the field', async () => {
  const expect = async (search: string, field: string): Promise<void> => {
    const response = await earningsGET(get(STORE_A, tokenA, search), params(STORE_A));
    assert.equal(response.status, 400, search);
    const body = (await response.json()) as { field?: string; code?: string };
    assert.deepEqual([body.field, body.code], [field, 'ACCOUNT_BODY_INVALID'], search);
  };
  await expect('?period=custom', 'from');
  await expect('?period=custom&from=2026-11-01', 'to');
  await expect('?period=custom&from=2026-11-10&to=2026-11-01', 'to');
  await expect('?period=custom&from=2026-02-30&to=2026-03-01', 'from');
  await expect('?period=custom&from=2025-01-01&to=2026-11-01', 'to');
  await expect('?period=14', 'period');
  await expect('?type=bogus', 'type');
  await expect('?limit=500', 'limit');
  await expect('?page=0', 'page');
  await expect('?storeId=' + STORE_B, 'storeId');
});

// ---------------------------------------------------------------------------------------------------- the report (B10)

const reportRequest = (search: string, secret = MOD_SECRET): NextRequest => {
  const path = '/api/internal/commission/report' + search;
  return new NextRequest('http://seller.test' + path, { headers: internalRequestHeaders(secret, { method: 'GET', path, adminId: 'admin-1', body: '' }) });
};

test('the report is the same ledger sums as the earnings summary, plus the order count and the balance', async () => {
  ledger();
  const report = await buildCommissionReport(commissionReportQuerySchema.parse({ storeId: STORE_A, period: '30' }), NOW);
  const earnings = await buildEarnings(STORE_A, query(), NOW);
  assert.deepEqual(
    [report.commissionEarned, report.sales, report.ordersCount, report.balance, report.storeName],
    [earnings.summary.commission, earnings.summary.sales, 1, earnings.allTime.balance, 'Zara Lawn'],
  );
  assert.deepEqual(report.period, { key: '30', from: '2026-10-17', to: '2026-11-15' });
  assert.equal((await buildCommissionReport(commissionReportQuerySchema.parse({ storeId: STORE_B, period: 'today' }), NOW)).ordersCount, 0);
  const err = await buildCommissionReport(commissionReportQuerySchema.parse({ storeId: '65a0000000000000000fffff', period: '7' }), NOW).catch((e: unknown) => e);
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 404);
});

test('the report route answers only to the admin backend\'s signature, and checks the query', async () => {
  ledger();
  const ok = await reportGET(reportRequest('?storeId=' + STORE_A + '&period=custom&from=2026-11-10&to=2026-11-12'));
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { commissionEarned: number; sales: number; ordersCount: number };
  assert.deepEqual([body.commissionEarned, body.sales, body.ordersCount], [60, 1500, 1]);
  assert.equal((await reportGET(new NextRequest('http://seller.test/api/internal/commission/report?storeId=' + STORE_A))).status, 401);
  assert.equal((await reportGET(reportRequest('?storeId=' + STORE_A, 'z'.repeat(40)))).status, 401);
  const asSeller = new NextRequest('http://seller.test/api/internal/commission/report?storeId=' + STORE_A, { headers: { authorization: 'Bearer ' + tokenA } });
  assert.equal((await reportGET(asSeller)).status, 401, 'a seller session means nothing here');
  assert.equal((await reportGET(reportRequest('?storeId=' + STORE_A + '&period=custom'))).status, 422);
  assert.equal((await reportGET(reportRequest('?period=30'))).status, 422);
  for (const actor of ['seller', 'system', 'public'] as const) assert.throws(() => assertCan(actor, 'read', 'commissionReport'));
});
