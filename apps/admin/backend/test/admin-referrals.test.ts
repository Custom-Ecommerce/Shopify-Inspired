import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportReferralsFor, listReferralsFor, parseReferralQuery, referralSteps, toReferralCsv } from '../src/lib/admin-referrals';

// Sprint 8 (S8-B6, D-118): the admin's referrals view and rewards CSV. The signed call to the seller backend and the audit are stubbed. The level gate of the
// two routes is in test/admin-levels.test.ts.

const row = (extra: Record<string, unknown> = {}) => ({
  id: '65a0000000000000000000b1',
  referrer: { id: '65a000000000000000000001', name: 'Sana Khan', email: 'sana@example.com' },
  referred: 'B*** A.',
  status: 'rewarded' as const,
  months: 1,
  createdAt: '2026-11-01T10:00:00.000Z',
  rewardedAt: '2026-11-20T10:00:00.000Z',
  paymentVoidedAt: null,
  ...extra,
});

let saved: typeof referralSteps;
let calls: unknown[];
let audits: unknown[][];
beforeEach(() => {
  saved = { ...referralSteps };
  calls = [];
  audits = [];
  referralSteps.list = async (_admin, input) => {
    calls.push(input);
    return { docs: [row()], page: 1, limit: 20, totalDocs: 1, totalPages: 1 };
  };
  referralSteps.export = async (_admin, input) => {
    calls.push(input);
    return { rows: [row()], truncated: true };
  };
  referralSteps.audit = async (...args) => void audits.push(args);
});
afterEach(() => Object.assign(referralSteps, saved));

const get = (query: string) => new Request('http://admin.test/api/admin/referrals' + query);

test('the filters are checked and only the known ones go to the seller backend', async () => {
  assert.deepEqual(parseReferralQuery(new URLSearchParams('status=capped&q=%20sana%20&from=2026-11-01&to=2026-11-30&page=2&limit=50&evil=1')), {
    status: 'capped', q: 'sana', from: '2026-11-01', to: '2026-11-30', page: 2, limit: 50,
  });
  assert.deepEqual(parseReferralQuery(new URLSearchParams('')), { page: 1, limit: 20 });
  for (const bad of ['status=paid', 'from=yesterday', 'from=2026-11-30&to=2026-11-01', 'page=0', 'limit=51', 'q=' + 'x'.repeat(101)]) {
    assert.throws(() => parseReferralQuery(new URLSearchParams(bad)), (err: any) => err.status === 400, bad);
  }
  const res = await listReferralsFor(get('?status=rewarded'), 'admin1');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, [{ status: 'rewarded', page: 1, limit: 20 }]);
});

test('the CSV has a BOM, a header, CRLF lines and the formula guard', () => {
  const csv = toReferralCsv([row({ referrer: { id: 'a', name: '=HYPERLINK("x")', email: '+sum@example.com' }, referred: '@*** K.' })]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^"Referral id","Referrer name","Referrer email","Referred \(masked\)","Months"/);
  assert.ok(lines[1]!.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(lines[1]!.includes('"\'+sum@example.com"'));
  assert.ok(lines[1]!.includes('"\'@*** K."'));
});

test('the export is audited before the file is returned, says when it was cut, and fails closed', async () => {
  const res = await exportReferralsFor(get('/export?from=2026-11-01'), 'admin1');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-export-truncated'), 'true');
  assert.match(res.headers.get('content-disposition')!, /referral-rewards\.csv/);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]![0], 'referrals.exported');
  assert.deepEqual(calls, [{ from: '2026-11-01' }]);

  referralSteps.audit = async () => {
    throw new Error('audit down');
  };
  await assert.rejects(() => exportReferralsFor(get('/export'), 'admin1'), (err: any) => err.status === 503);
});
