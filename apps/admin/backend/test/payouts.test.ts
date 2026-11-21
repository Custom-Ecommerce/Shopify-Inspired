import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User, signSession } from '@/lib/workspace';
import { ADMIN_AUDIENCE, AdminHttpError } from '@/lib/admin-auth';
import { payoutSteps, readAdminQuery } from '@/lib/admin-payouts';
import { COMMISSION_REPORT_HEADER, CSV_BOM, PAYMENT_TYPE_LABELS, buildCommissionReportCsv, commissionReportFileName, csvCell } from '@/lib/commission-report-csv';
import { commissionReportQuerySchema, payoutListQuerySchema } from '@/lib/payout-contracts';

// Sprint 4 EP-05.US03, US06 (D-090): the admin side of payouts and the commission report CSV. The seller backend is stubbed
// (payoutSteps); no database, no network.

const SECRET = 'x'.repeat(40);
const ADMIN_ID = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const PAYOUT = '65a000000000000000000021';
const ACCOUNT_NUMBER = '03001234567';
const UserModel = User as any;

const payoutRow = (extra: Record<string, unknown> = {}) => ({
  id: PAYOUT,
  storeId: STORE,
  storeName: 'Zara Lawn',
  amount: 2110,
  method: 'jazzcash',
  reference: 'JC-778812',
  note: null,
  status: 'paid',
  cutoff: '2026-11-10T12:00:00.000Z',
  entryCount: 3,
  details: { method: 'jazzcash', accountTitle: 'Zara Khan', last4: '4567', bankName: null },
  createdBy: ADMIN_ID,
  paidAt: '2026-11-10T12:00:01.000Z',
  failedReason: null,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  createdAt: '2026-11-10T12:00:00.000Z',
  ...extra,
});

const report = (extra: Record<string, unknown> = {}) => ({
  storeId: STORE,
  storeName: 'Zara Lawn',
  period: { key: '30', from: '2026-10-17', to: '2026-11-15' },
  commissionEarned: 60,
  sales: 1500,
  ordersCount: 1,
  balance: -60,
  ...extra,
});

// ----------------------------------------------------------------------------------------------------------- CSV (B10)

test('the CSV starts with a UTF-8 byte order mark, quotes its text and writes numbers as numbers', () => {
  const csv = buildCommissionReportCsv([report() as never]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.startsWith(CSV_BOM), true);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 3, 'a header, one row and the closing line break');
  assert.equal(lines[2], '');
  assert.equal(lines[0], COMMISSION_REPORT_HEADER.map((name) => '"' + name + '"').join(','));
  assert.equal(lines[1], '"Zara Lawn","' + STORE + '","30","2026-10-17","2026-11-15",60,1500,1,-60,"All orders"');
});

test('a quote, a comma and a line break stay inside their cell', () => {
  assert.equal(csvCell('Zara "Lawn", Lahore'), '"Zara ""Lawn"", Lahore"');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('زارا لان'), '"زارا لان"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(''), '""');
});

test('a text cell that starts with = + - @ (or a tab or a carriage return) cannot run as a formula', () => {
  for (const name of ['=HYPERLINK("http://evil","click")', '+1+1', '-2+3', '@SUM(A1:A9)', '\tcmd', '\rcmd']) {
    const cell = csvCell(name);
    assert.ok(cell.startsWith('"\''), JSON.stringify(name) + ' -> ' + JSON.stringify(cell));
    assert.equal(cell.slice(2, 3), name.slice(0, 1).replace('"', '""'));
  }
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('Zara =Lawn'), '"Zara =Lawn"', 'only the first character matters');
  assert.equal(csvCell('0=1'), '"0=1"');
  const csv = buildCommissionReportCsv([report({ storeName: '=cmd|\' /C calc\'!A0' }) as never]);
  assert.ok(csv.includes('"\'=cmd|\' /C calc\'!A0"'));
});

test('a negative number stays a number: the guard is for text only', () => {
  assert.equal(csvCell(-60), '-60');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(Number.NaN), '""');
  assert.equal(csvCell('-60'), '"\'-60"', 'the same digits as text are guarded');
});

test('an empty report is only the header, and the file name holds ids and days, never a store name', () => {
  const csv = buildCommissionReportCsv([]);
  assert.equal(csv.slice(1).split('\r\n').length, 2);
  assert.equal(commissionReportFileName(report() as never), 'commission-report-' + STORE + '-2026-10-17-to-2026-11-15.csv');
});

// ------------------------------------------------------------------------------------------------------ the query reader

test('a GET query is checked with the shared schema and a problem names the field', () => {
  const read = (search: string) => readAdminQuery(new Request('http://admin.test/api/admin/payouts' + search), payoutListQuerySchema);
  assert.deepEqual(read(''), { page: 1, limit: 20 });
  assert.deepEqual(read('?status=paid&page=2'), { page: 2, limit: 20, status: 'paid' });
  for (const [search, field] of [['?status=done', 'status'], ['?limit=500', 'limit'], ['?storeId=x', 'storeId'], ['?sort=amount', 'sort']] as const) {
    try {
      read(search);
      assert.fail('expected a refusal for ' + search);
    } catch (err) {
      assert.ok(err instanceof AdminHttpError, search);
      assert.deepEqual([err.status, err.field], [400, field], search);
    }
  }
  const reportRead = (search: string, ignore: string[] = []) => readAdminQuery(new Request('http://admin.test/x' + search), commissionReportQuerySchema, ignore);
  assert.deepEqual(reportRead('?storeId=' + STORE + '&format=csv', ['format']), { storeId: STORE, period: '30' });
  assert.throws(() => reportRead('?storeId=' + STORE + '&format=csv'), AdminHttpError);
});

// ---------------------------------------------------------------------------------------------------------------- routes

let restore: () => void = () => {};
let events: string[] = [];
let auditCalls: Array<{ action: string; entity: string; entityId: string; actorId: string; details: Record<string, unknown> }> = [];
let auditFails = false;
let routes: {
  details: (request: Request) => Promise<Response>;
  balances: (request: Request) => Promise<Response>;
  history: { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> };
  voidPOST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  finishPOST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  report: (request: Request) => Promise<Response>;
};

before(async () => {
  process.env.ADMIN_AUTH_SECRET = SECRET;
  process.env.MONGODB_URI = 'mongodb://stub.invalid/admin';
  routes = {
    details: (await import('../src/app/api/admin/payouts/details/route')).POST,
    balances: (await import('../src/app/api/admin/payouts/balances/route')).GET,
    history: await import('../src/app/api/admin/payouts/route'),
    voidPOST: (await import('../src/app/api/admin/payouts/[id]/void/route')).POST,
    finishPOST: (await import('../src/app/api/admin/payouts/[id]/finish/route')).POST,
    report: (await import('../src/app/api/admin/commission/report/route')).GET,
  };
});

beforeEach(() => {
  events = [];
  auditCalls = [];
  auditFails = false;
  const steps = payoutSteps as any;
  const saved = { ...steps };
  const original = { connect: (mongoose as any).connect, findById: UserModel.findById };
  (mongoose as any).connect = async () => mongoose;
  UserModel.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin' }) }) });
  steps.audit = async (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => {
    if (auditFails) throw new Error('the audit log is down');
    events.push('audit:' + action);
    auditCalls.push({ action, entity, entityId, actorId, details });
    return { id: 'audit-1' };
  };
  steps.details = async (_admin: string, input: { storeId: string }) => {
    events.push('seller:details');
    return { storeId: input.storeId, method: 'jazzcash', accountTitle: 'Zara Khan', accountNumber: ACCOUNT_NUMBER, bankName: null };
  };
  steps.create = async (_admin: string, input: { storeId: string }) => (events.push('seller:create'), payoutRow({ storeId: input.storeId }));
  steps.void = async () => (events.push('seller:void'), payoutRow({ status: 'voided', voidReason: 'Sent to the wrong account' }));
  steps.finish = async () => (events.push('seller:finish'), payoutRow());
  steps.listBalances = async () => ({ docs: [], page: 1, limit: 20, totalDocs: 0, totalPages: 0 });
  steps.listHistory = async () => ({ docs: [payoutRow()], page: 1, limit: 20, totalDocs: 1, totalPages: 1 });
  steps.report = async () => report();
  restore = () => {
    Object.assign(steps, saved);
    (mongoose as any).connect = original.connect;
    UserModel.findById = original.findById;
  };
});

afterEach(() => restore());

async function req(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<Request> {
  const token = init.token === undefined ? await signSession({ sub: ADMIN_ID, role: 'admin' }, SECRET, ADMIN_AUDIENCE) : init.token;
  return new Request('http://admin.test' + path, {
    method: init.method ?? 'GET',
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test('every payout route needs an admin session', async () => {
  const anonymous = { token: null } as const;
  assert.equal((await routes.balances(await req('/api/admin/payouts/balances', anonymous))).status, 401);
  assert.equal((await routes.history.GET(await req('/api/admin/payouts', anonymous))).status, 401);
  assert.equal((await routes.history.POST(await req('/api/admin/payouts', { ...anonymous, method: 'POST', body: {} }))).status, 401);
  assert.equal((await routes.details(await req('/api/admin/payouts/details', { ...anonymous, method: 'POST', body: { storeId: STORE } }))).status, 401);
  assert.equal((await routes.voidPOST(await req('/x', { ...anonymous, method: 'POST', body: { reason: 'abc' } }), ctx(PAYOUT))).status, 401);
  assert.equal((await routes.finishPOST(await req('/x', { ...anonymous, method: 'POST' }), ctx(PAYOUT))).status, 401);
  assert.equal((await routes.report(await req('/api/admin/commission/report?storeId=' + STORE, anonymous))).status, 401);
  const sellerToken = await signSession({ sub: ADMIN_ID, role: 'seller' }, SECRET, 'seller-backend');
  assert.equal((await routes.details(await req('/api/admin/payouts/details', { token: sellerToken, method: 'POST', body: { storeId: STORE } }))).status, 401);
  assert.deepEqual(events, [], 'nothing reached the seller backend or the audit log');
});

test('the full payout account is audited BEFORE it is fetched, never in the audit entry, and not at all when the audit fails', async () => {
  const shown = await routes.details(await req('/api/admin/payouts/details', { method: 'POST', body: { storeId: STORE } }));
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get('cache-control'), 'no-store');
  assert.equal(((await shown.json()) as { details: { accountNumber: string } }).details.accountNumber, ACCOUNT_NUMBER);
  assert.deepEqual(events, ['audit:payout_details_viewed', 'seller:details'], 'the entry goes in first');
  assert.deepEqual([auditCalls[0]!.entity, auditCalls[0]!.entityId, auditCalls[0]!.actorId], ['store', STORE, ADMIN_ID]);
  assert.equal(JSON.stringify(auditCalls).includes(ACCOUNT_NUMBER), false);

  events.length = 0;
  auditFails = true;
  const refused = await routes.details(await req('/api/admin/payouts/details', { method: 'POST', body: { storeId: STORE } }));
  assert.equal(refused.status, 503);
  assert.equal(JSON.stringify(await refused.json()).includes(ACCOUNT_NUMBER), false);
  assert.deepEqual(events, [], 'no entry, no number: the seller backend was never asked');

  auditFails = false;
  assert.equal((await routes.details(await req('/api/admin/payouts/details', { method: 'POST', body: { storeId: 'nope' } }))).status, 400);
  assert.equal((await routes.details(await req('/api/admin/payouts/details', { method: 'POST', body: { storeId: STORE, reveal: true } }))).status, 400);
});

test('a payout is made by the seller backend and then audited; a failing audit does not undo it', async () => {
  const body = { storeId: STORE, expectedBalance: 2110, method: 'jazzcash', reference: ' JC-778812 ', note: '' };
  const made = await routes.history.POST(await req('/api/admin/payouts', { method: 'POST', body }));
  assert.equal(made.status, 200);
  assert.equal(((await made.json()) as { payout: { status: string } }).payout.status, 'paid');
  assert.deepEqual(events, ['seller:create', 'audit:payout.create']);
  assert.equal(auditCalls[0]!.entityId, STORE);
  assert.equal(auditCalls[0]!.actorId, ADMIN_ID);
  assert.equal(JSON.stringify(auditCalls).includes(ACCOUNT_NUMBER), false);

  auditFails = true;
  const again = await routes.history.POST(await req('/api/admin/payouts', { method: 'POST', body }));
  assert.equal(again.status, 200, 'the payout stands; the missing entry is logged');
});

test('a bad payout request is a 400 that names the field, before the seller backend is asked', async () => {
  const send = async (body: unknown) => routes.history.POST(await req('/api/admin/payouts', { method: 'POST', body }));
  const good = { storeId: STORE, expectedBalance: 2110, method: 'jazzcash', reference: 'JC-1' };
  for (const [bad, field] of [
    [{ ...good, expectedBalance: 0 }, 'expectedBalance'],
    [{ ...good, expectedBalance: 10.5 }, 'expectedBalance'],
    [{ ...good, method: 'cheque' }, 'method'],
    [{ ...good, reference: '' }, 'reference'],
    [{ ...good, storeId: 'x' }, 'storeId'],
    [{ ...good, amount: 5 }, 'amount'],
  ] as const) {
    const response = await send(bad);
    assert.equal(response.status, 400, field);
    const payload = (await response.json()) as { field?: string; code?: string };
    assert.deepEqual([payload.field, payload.code], [field, 'ACCOUNT_BODY_INVALID']);
  }
  assert.deepEqual(events, []);
});

test('void and finish take the id from the path, check it, and audit after the seller backend did it', async () => {
  assert.equal((await routes.voidPOST(await req('/x', { method: 'POST', body: { reason: 'Sent to the wrong account' } }), ctx('nope'))).status, 404);
  assert.equal((await routes.voidPOST(await req('/x', { method: 'POST', body: { reason: 'ab' } }), ctx(PAYOUT))).status, 400);
  assert.equal((await routes.voidPOST(await req('/x', { method: 'POST', body: { payoutId: PAYOUT, reason: 'Sent to the wrong account' } }), ctx(PAYOUT))).status, 400, 'the id is not taken from the body');
  assert.deepEqual(events, []);

  const voided = await routes.voidPOST(await req('/x', { method: 'POST', body: { reason: 'Sent to the wrong account' } }), ctx(PAYOUT));
  assert.equal(voided.status, 200);
  assert.equal(((await voided.json()) as { payout: { status: string } }).payout.status, 'voided');
  const finished = await routes.finishPOST(await req('/x', { method: 'POST' }), ctx(PAYOUT));
  assert.equal(finished.status, 200);
  assert.deepEqual(events, ['seller:void', 'audit:payout.void', 'seller:finish', 'audit:payout.finish']);
  assert.equal((await routes.finishPOST(await req('/x', { method: 'POST' }), ctx('nope'))).status, 404);
});

test('the balance and history lists pass the checked query through and answer what the seller backend answered', async () => {
  const balances = await routes.balances(await req('/api/admin/payouts/balances?page=1&limit=20&q=zara'));
  assert.equal(balances.status, 200);
  assert.equal(((await balances.json()) as { totalDocs: number }).totalDocs, 0);
  assert.equal((await routes.balances(await req('/api/admin/payouts/balances?limit=500'))).status, 400);
  const history = await routes.history.GET(await req('/api/admin/payouts?status=pending_settle'));
  assert.equal(history.status, 200);
  assert.equal(((await history.json()) as { docs: unknown[] }).docs.length, 1);
  assert.equal((await routes.history.GET(await req('/api/admin/payouts?status=done'))).status, 400);
});

test('the report is JSON, or a CSV download of the same numbers with a byte order mark', async () => {
  const json = await routes.report(await req('/api/admin/commission/report?storeId=' + STORE + '&period=30'));
  assert.equal(json.status, 200);
  assert.deepEqual(((await json.json()) as { report: { commissionEarned: number; sales: number } }).report.commissionEarned, 60);

  const csv = await routes.report(await req('/api/admin/commission/report?storeId=' + STORE + '&period=30&format=csv'));
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="commission-report-' + STORE + '-2026-10-17-to-2026-11-15.csv"');
  assert.equal(csv.headers.get('cache-control'), 'no-store');
  const bytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a UTF-8 byte order mark');
  assert.ok(new TextDecoder().decode(bytes).includes(',60,1500,1,-60'));

  assert.equal((await routes.report(await req('/api/admin/commission/report?period=30'))).status, 400, 'a store is required');
  assert.equal((await routes.report(await req('/api/admin/commission/report?storeId=' + STORE + '&period=custom'))).status, 400);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-12.US04.T04 (D-116): the commission report labels its cash on delivery and gateway rows.

const SPLIT = {
  cod: { commissionEarned: 0, sales: 5000, ordersCount: 3 },
  gateway: { commissionEarned: 60, sales: 1500, ordersCount: 1 },
};

test('Sprint 6: a report with the split writes one labelled row for all orders, one for cash on delivery and one for gateway orders', () => {
  const csv = buildCommissionReportCsv([report({ commissionEarned: 60, sales: 6500, ordersCount: 4, ...SPLIT }) as never]);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 5, 'a header, three rows and the closing line break');
  assert.equal(lines[0]!.endsWith(',"Payment type"'), true);
  assert.equal(lines[1], '"Zara Lawn","' + STORE + '","30","2026-10-17","2026-11-15",60,6500,4,-60,"' + PAYMENT_TYPE_LABELS.all + '"');
  assert.equal(lines[2], '"Zara Lawn","' + STORE + '","30","2026-10-17","2026-11-15",0,5000,3,"","Cash on delivery"');
  assert.equal(lines[3], '"Zara Lawn","' + STORE + '","30","2026-10-17","2026-11-15",60,1500,1,"","Gateway (card)"');
});

test('Sprint 6: the split rows add up to the totals row, and COD at 0 percent shows a commission of 0 as a number', () => {
  const csv = buildCommissionReportCsv([report({ commissionEarned: 60, sales: 6500, ordersCount: 4, ...SPLIT }) as never]);
  const rows = csv.slice(1).split('\r\n').slice(1, 4).map((line) => line.split(','));
  const num = (row: string[], at: number) => Number(row[at]);
  assert.equal(num(rows[1]!, 5) + num(rows[2]!, 5), num(rows[0]!, 5));
  assert.equal(num(rows[1]!, 6) + num(rows[2]!, 6), num(rows[0]!, 6));
  assert.equal(num(rows[1]!, 7) + num(rows[2]!, 7), num(rows[0]!, 7));
  assert.equal(rows[1]![5], '0');
});

test('Sprint 6: a report without the split (an older seller backend) is still one labelled row', () => {
  const lines = buildCommissionReportCsv([report() as never]).slice(1).split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1]!.endsWith(',"All orders"'), true);
});

test('Sprint 6: a report with only one part writes only that part after the totals', () => {
  const lines = buildCommissionReportCsv([report({ cod: SPLIT.cod }) as never]).slice(1).split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[2]!.endsWith(',"Cash on delivery"'), true);
});

test('Sprint 6: the payment type labels are fixed text, never a store name, so they never need the formula guard', () => {
  for (const label of Object.values(PAYMENT_TYPE_LABELS)) assert.equal(csvCell(label), '"' + label + '"');
});
