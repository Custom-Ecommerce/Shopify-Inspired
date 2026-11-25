import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, CommissionEntry, Order, Store, signSession } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { setMembershipLoader } from '../src/lib/data-plane';
import { rolesForRoute } from '../src/lib/route-capabilities';
import { resolveReportRange, SALES_REPORT_BATCH, SALES_REPORT_SELECT } from '../src/lib/sales-report';
import { setSessionUserLoader } from '../src/lib/session-user';
import { matchDoc } from './helpers/aggregate';

// Sprint 8 (S8-B7, D-118): the sales report download. Models are in memory; no database.

const SECRET = 'x'.repeat(40);
const OWNER = '65a000000000000000000001';
const OWNER_B = '65a000000000000000000002';
const MANAGER = '65a000000000000000000003';
const STAFF = '65a000000000000000000004';
const SUPPORT = '65a000000000000000000005';
const ADMIN = '65a000000000000000000009';
const STORE_A = '65a000000000000000000011';
const STORE_B = '65a000000000000000000012';
const PII = ['Ayesha Khan', '+923001234567', 'ayesha@example.com', 'House 7, Street 9'];

type Row = Record<string, any>;
let orders: Row[];
let entries: Row[];
let audits: Row[];
let selects: string[];
let batches: number[];
let failAudit: boolean;
let totalOverride: number | null;
let restore: () => void = () => {};
const tokens: Record<string, string> = {};
let GET: (request: NextRequest, context: any) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  for (const [name, id, role] of [['owner', OWNER, 'seller'], ['ownerB', OWNER_B, 'seller'], ['manager', MANAGER, 'seller'], ['staff', STAFF, 'seller'], ['support', SUPPORT, 'seller'], ['admin', ADMIN, 'admin']] as const) {
    tokens[name] = await signSession({ sub: id, role }, SECRET, SELLER_AUDIENCE);
  }
  GET = (await import('../src/app/api/stores/[id]/reports/sales/route')).GET;
});

let seq = 0;
function order(extra: Row = {}): Row {
  seq += 1;
  return {
    _id: '65a0000000000000000e' + String(seq).padStart(4, '0'),
    store: STORE_A,
    orderId: 'ORD-' + seq,
    status: 'delivered',
    paymentMethod: 'cod',
    subtotal: 1000,
    discountAmount: 100,
    deliveryCharges: 200,
    taxAmount: 50,
    total: 1150,
    createdAt: new Date(Date.UTC(2026, 10, 1, 6, 0, seq)),
    customerName: PII[0],
    phone: PII[1],
    customerEmail: PII[2],
    address: PII[3],
    ...extra,
  };
}

beforeEach(() => {
  seq = 0;
  orders = [
    order({ status: 'delivered' }),
    order({ paymentMethod: 'card', status: 'confirmed', discountAmount: undefined, taxAmount: undefined }),
    order({ status: 'returned' }),
    order({ paymentMethod: undefined, status: 'pending' }),
    order({ store: STORE_B, orderId: 'ORD-OTHER' }),
  ];
  const [first, second, third] = orders as [Row, Row, Row];
  entries = [
    { store: STORE_A, order: first._id, type: 'cod_commission', balanceEffect: 0, reversesType: null },
    { store: STORE_A, order: second._id, type: 'card_sale', balanceEffect: 1150, reversesType: null },
    { store: STORE_A, order: second._id, type: 'card_commission', balanceEffect: -45, reversesType: null },
    { store: STORE_A, order: third._id, type: 'cod_commission', balanceEffect: -30, reversesType: null },
    { store: STORE_A, order: third._id, type: 'reversal', balanceEffect: 30, reversesType: 'cod_commission' },
  ];
  audits = [];
  selects = [];
  batches = [];
  failAudit = false;
  totalOverride = null;
  const O = Order as any;
  const C = CommissionEntry as any;
  const S = Store as any;
  const A = AuditLog as any;
  const saved = { connect: (mongoose as any).connect, find: O.find, count: O.countDocuments, entries: C.find, exists: S.exists, one: S.findOne, audit: A.create };
  (mongoose as any).connect = async () => mongoose;
  O.countDocuments = async (filter: Row) => totalOverride ?? orders.filter((row) => matchDoc(row, filter)).length;
  O.find = (filter: Row) => {
    let rows = orders.filter((row) => matchDoc(row, filter));
    const q: any = {
      sort: (by: Row) => {
        assert.deepEqual(by, { createdAt: -1, _id: -1 });
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return q;
      },
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      select: (fields: string) => (selects.push(fields), q),
      lean: () => q,
      cursor: (options: Row) => {
        assert.equal(options.batchSize, SALES_REPORT_BATCH);
        const picked = rows.map((row) => Object.fromEntries(['_id', ...SALES_REPORT_SELECT.split(' ')].map((field) => [field, row[field]])));
        return (async function* () {
          for (const row of picked) yield row;
        })();
      },
    };
    return q;
  };
  C.find = (filter: Row) => {
    batches.push(filter.order.$in.length);
    const ids = filter.order.$in.map(String);
    const found = entries.filter((e) => e.store === filter.store && ids.includes(e.order) && (filter.$or as Row[]).some((branch) => matchDoc(e, branch)));
    return { select: () => ({ lean: async () => found }) };
  };
  const owners: Record<string, string> = { [STORE_A]: OWNER, [STORE_B]: OWNER_B };
  S.exists = async (filter: Row) => (owners[String(filter._id)] === String(filter.owner) ? { _id: filter._id } : null);
  S.findOne = (filter: Row) => ({ select: () => ({ lean: async () => (owners[String(filter._id)] ? { _id: filter._id, name: 'Shop', owner: owners[String(filter._id)] } : null) }) });
  A.create = async (doc: Row) => {
    if (failAudit) throw new Error('audit down');
    audits.push(doc);
    return { _id: 'a1' };
  };
  const members: Record<string, string> = { [MANAGER]: 'manager', [STAFF]: 'staff', [SUPPORT]: 'support' };
  setSessionUserLoader(async (id: string) => ({ role: id === ADMIN ? 'admin' : 'seller', accountStatus: 'active', tokenVersion: 0, emailVerifiedAt: new Date() }) as never);
  setMembershipLoader(async (storeId, userId) => (storeId === STORE_A && members[userId] ? { role: members[userId]! } : null));
  restore = () => {
    (mongoose as any).connect = saved.connect;
    O.find = saved.find;
    O.countDocuments = saved.count;
    C.find = saved.entries;
    S.exists = saved.exists;
    S.findOne = saved.one;
    A.create = saved.audit;
    setSessionUserLoader(null);
    setMembershipLoader(null);
  };
});
afterEach(() => restore());

const RANGE = '?from=2026-11-01&to=2026-11-30';
function download(query = RANGE, who: string | null = 'owner', store = STORE_A): Promise<Response> {
  const headers: Record<string, string> = who === null ? {} : { authorization: 'Bearer ' + tokens[who]!, 'x-store-id': store };
  return GET(new NextRequest('http://seller.test/api/stores/' + store + '/reports/sales' + query, { headers }), { params: Promise.resolve({ id: store }) });
}
const textOf = async (res: Response): Promise<string> => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
const linesOf = (text: string): string[] => text.slice(1).split('\r\n').filter(Boolean);

test('the file: a BOM, the columns, newest first, money in whole rupees, ISO dates, the ledger commission (0 at 0%, net of reversals, empty without an entry)', async () => {
  const res = await download();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition')!, /sales-2026-11-01-to-2026-11-30\.csv/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-report-rows'), '4');
  assert.equal(res.headers.get('x-report-truncated'), null);
  const text = await textOf(res);
  assert.equal(text.charCodeAt(0), 0xfeff);
  const lines = linesOf(text);
  assert.equal(lines[0], '"Order number","Date (ISO)","Status","Payment method","Subtotal","Discount","Delivery","Tax","Total","Commission"');
  assert.deepEqual(lines.slice(1), [
    '"ORD-4","2026-11-01T06:00:04.000Z","pending","COD",1000,100,200,50,1150,""',
    '"ORD-3","2026-11-01T06:00:03.000Z","returned","COD",1000,100,200,50,1150,0',
    '"ORD-2","2026-11-01T06:00:02.000Z","confirmed","Card",1000,0,200,0,1150,45',
    '"ORD-1","2026-11-01T06:00:01.000Z","delivered","COD",1000,100,200,50,1150,0',
  ]);
});

test('no customer name, phone, email or address: not a column, not a value, not even read', async () => {
  const text = await textOf(await download());
  for (const value of PII) assert.equal(text.includes(value), false, value);
  assert.doesNotMatch(text, /customer|phone|email|address/i);
  for (const fields of selects) assert.doesNotMatch(fields, /customer|phone|email|address|city|note/i);
  assert.doesNotMatch(JSON.stringify(audits), /Ayesha|923001234567|ayesha@|House 7|ORD-/);
});

test('isolation: only this store\'s orders; another seller\'s store is 403, no session 401, an admin 403', async () => {
  assert.doesNotMatch(await textOf(await download()), /ORD-OTHER/);
  assert.equal((await download(RANGE, 'ownerB', STORE_A)).status, 403);
  assert.equal((await download(RANGE, 'owner', STORE_B)).status, 403);
  assert.equal((await download(RANGE, null)).status, 401);
  assert.equal((await download(RANGE, 'admin')).status, 403);
});

test('the owner and a manager may download; staff and support may not', async () => {
  assert.equal((await download(RANGE, 'manager')).status, 200);
  for (const who of ['staff', 'support']) {
    const res = await download(RANGE, who);
    assert.equal(res.status, 403, who);
    assert.equal(((await res.json()) as { code?: string }).code, 'CAPABILITY_DENIED');
  }
  assert.deepEqual(rolesForRoute('stores/[id]/reports/sales GET'), ['owner', 'manager']);
});

test('regression: the customers export stays owner and manager (never support), the products export keeps the product roles', () => {
  assert.deepEqual(rolesForRoute('stores/[id]/customers/export GET'), ['owner', 'manager']);
  assert.deepEqual(rolesForRoute('products/export GET'), ['owner', 'manager', 'staff']);
  assert.deepEqual(rolesForRoute('analytics GET'), ['owner', 'manager']);
});

test('the filters: dates in Pakistan time, status, and cash on delivery against the gateway', async () => {
  const ids = async (query: string) => linesOf(await textOf(await download(query))).slice(1).map((line) => line.split(',')[0]);
  assert.deepEqual(await ids(RANGE + '&status=returned'), ['"ORD-3"']);
  assert.deepEqual(await ids(RANGE + '&method=card'), ['"ORD-2"']);
  assert.deepEqual(await ids(RANGE + '&method=cod'), ['"ORD-4"', '"ORD-3"', '"ORD-1"'], 'an order with no recorded method is cash on delivery');
  orders.push(order({ orderId: 'ORD-LATE', createdAt: new Date('2026-11-30T19:30:00.000Z') }));
  assert.equal((await ids(RANGE)).includes('"ORD-LATE"'), false, '00:30 on 1 December in Pakistan');
  assert.equal((await ids('?from=2026-12-01&to=2026-12-01')).includes('"ORD-LATE"'), true);
});

test('the range: at most 366 days, defaults that fit, and a bad value is 400 with the field', async () => {
  const now = new Date('2026-11-25T10:00:00.000Z');
  assert.deepEqual(resolveReportRange({}, now), { from: '2025-11-25', to: '2026-11-25' });
  assert.deepEqual(resolveReportRange({ to: '2026-06-30' }, now), { from: '2025-06-30', to: '2026-06-30' });
  assert.deepEqual(resolveReportRange({ from: '2024-01-01' }, now), { from: '2024-01-01', to: '2024-12-31' });
  assert.deepEqual(resolveReportRange({ from: '2026-11-01' }, now), { from: '2026-11-01', to: '2026-11-25' });
  assert.deepEqual(resolveReportRange({ from: '2024-01-01', to: '2024-12-31' }, now), { from: '2024-01-01', to: '2024-12-31' }, '366 days of a leap year');
  assert.throws(() => resolveReportRange({ from: '2025-01-01', to: '2026-01-02' }, now), (err: any) => err.status === 400 && err.errorField === 'to');
  for (const [query, field] of [['?from=2026-02-30', 'from'], ['?to=yesterday', 'to'], ['?status=paid', 'status'], ['?method=bank', 'method'], ['?store=' + STORE_B, 'store'], ['?from=2026-11-30&to=2026-11-01', 'from']]) {
    const res = await download(query);
    assert.equal(res.status, 400, query);
    assert.equal(((await res.json()) as { field?: string }).field, field, query);
  }
  assert.equal(audits.length, 0);
});

test('the formula guard: a text cell that starts with = + - @ tab or CR is written as text', async () => {
  orders = ['=HYPERLINK("x")', '+1', '-2', '@x', '\tx', '\rx'].map((orderId) => order({ orderId }));
  const text = await textOf(await download());
  for (const start of ['"\'=HYPERLINK(""x"")"', '"\'+1"', '"\'-2"', '"\'@x"', '"\'\tx"', '"\'\rx"']) assert.ok(text.includes(start), JSON.stringify(start));
});

test('read in batches of 500 with a cursor, the commission looked up per batch', async () => {
  orders = Array.from({ length: 1201 }, () => order());
  const text = await textOf(await download());
  assert.equal(linesOf(text).length, 1202);
  assert.deepEqual(batches, [500, 500, 201]);
});

test('the cap is 10000 after sorting newest first, and a cut file says so in a header and in its first line', async () => {
  seq = 0;
  orders = Array.from({ length: 10_001 }, () => order());
  const res = await download();
  assert.equal(res.headers.get('x-report-truncated'), '1');
  assert.equal(res.headers.get('x-report-rows'), '10000');
  assert.equal(res.headers.get('x-report-row-cap'), '10000');
  const lines = linesOf(await textOf(res));
  assert.match(lines[0]!, /^"Truncated: only the newest 10000 orders/);
  assert.equal(lines.length, 10_002);
  assert.ok(lines[2]!.startsWith('"ORD-10001"'), 'the newest is kept');
  assert.equal(lines.some((line) => line.startsWith('"ORD-1",')), false, 'the oldest is left out');
  assert.equal(audits[0]!.details.truncated, true);
});

test('every download is audited with who, the role, the filters and the row count, and no data; no entry, no file', async () => {
  await download(RANGE + '&status=delivered', 'manager');
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0]!.action, audits[0]!.entity, audits[0]!.entityId, audits[0]!.actorId], ['report.sales_exported', 'store', STORE_A, 'seller:' + MANAGER + ':manager']);
  const { at, ...details } = audits[0]!.details;
  assert.ok(at);
  assert.deepEqual(details, { role: 'manager', filters: { from: '2026-11-01', to: '2026-11-30', status: 'delivered', method: null }, rows: 1, truncated: false });

  failAudit = true;
  const saved = console.error;
  console.error = () => {};
  try {
    const res = await download();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('content-type')!.startsWith('application/json'), true);
  } finally {
    console.error = saved;
  }
});

test('the guard is the shared one, not a copy', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'lib', 'sales-report.ts'), 'utf8');
  assert.match(source, /@markaz\/platform-kit\/csv/);
  assert.doesNotMatch(source, /\[=\+/, 'no second formula pattern');
  const admin = readFileSync(join(process.cwd(), '..', '..', 'admin', 'backend', 'src', 'lib', 'admin-audit-export.ts'), 'utf8');
  assert.match(admin, /@markaz\/platform-kit\/csv/);
});
