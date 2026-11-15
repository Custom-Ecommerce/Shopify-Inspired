import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { internalRequestHeaders } from '@markaz/platform-kit/internal-signature';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { HttpError } from '@/lib/http';
import { assertCan, signSession } from '@/lib/services';
import { sendPayoutPaid, sendPayoutVoided } from '@/lib/notifications';
import { createPayout, finishPayout, listBalances, listPayouts, payoutDeps, readFullPayoutDetails, voidPayout } from '@/lib/payouts';
import { ACCOUNT_NUMBER, ADMIN, OWNER_A, STORE_A, STORE_B, installLedgerWorld, type Row, type World } from './helpers/ledger-world';

// Sprint 4 EP-05.US03, US06 (D-088, D-090): payouts against the commission ledger. The ledger, payouts, stores and owners are
// in memory (test/helpers/ledger-world.ts); the settlement code under test is the real one.

const MOD_SECRET = 'm'.repeat(40);
const AUTH_SECRET = 'x'.repeat(40);
const NOW = new Date('2026-11-10T12:00:00.000Z');

let world: World;
let realNow: () => Date;
let sellerToken = '';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  sellerToken = await signSession({ sub: OWNER_A, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
});

beforeEach(() => {
  world = installLedgerWorld();
  realNow = payoutDeps.now;
  payoutDeps.now = () => NOW;
  process.env.MODERATION_API_SECRET = MOD_SECRET;
  process.env.APP_BASE_URL_SELLER = 'https://seller.markazify.com';
  delete process.env.EMAIL_PROVIDER;
});

afterEach(() => {
  payoutDeps.now = realNow;
  delete process.env.MODERATION_API_SECRET;
  delete process.env.APP_BASE_URL_SELLER;
  world.restore();
});

/** Store A's open ledger: a card sale of 2,250, its commission of 60 and a COD commission of 80. Balance 2,110, three entries. */
function seed(): Row[] {
  return [
    world.entry({ type: 'card_sale', order: '65a0000000000000000a0001', balanceEffect: 2250, baseAmount: 2250 }),
    world.entry({ type: 'card_commission', order: '65a0000000000000000a0001', balanceEffect: -60, baseAmount: 1500 }),
    world.entry({ type: 'cod_commission', order: '65a0000000000000000a0002', balanceEffect: -80, baseAmount: 2000 }),
  ];
}

const input = (expectedBalance = 2110, extra: Row = {}) => ({ storeId: STORE_A, expectedBalance, method: 'jazzcash' as const, reference: 'JC-778812', note: null, ...extra });

async function refused(run: Promise<unknown>): Promise<HttpError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof HttpError, 'expected an HttpError, got ' + String(err));
    return err;
  }
  assert.fail('expected a refusal');
}

const free = (entry: Row): boolean => entry.settledAt === null && entry.payoutId === null;

// ---------------------------------------------------------------------------------------------------------- balances

test('balances: the sum of each store\'s unsettled entries, with what the admin needs before paying', async () => {
  seed();
  world.entry({ type: 'cod_commission', balanceEffect: 999, settledAt: new Date('2026-11-02T00:00:00Z'), payoutId: 'a0a0a0a0a0a0a0a0a0a0a0a0' });
  world.entry({ store: STORE_B, type: 'cod_commission', balanceEffect: -300, baseAmount: 7500 });
  const list = await listBalances({ page: 1, limit: 20 });
  assert.equal(list.totalDocs, 2);
  assert.equal(list.totalPages, 1);
  const [a, b] = list.docs;
  assert.deepEqual(
    [a!.storeId, a!.storeName, a!.balance, a!.unsettledEntries, a!.payoutMethod, a!.payoutLast4, a!.hasPayoutDetails, a!.emailVerified, a!.hasPendingPayout],
    [STORE_A, 'Zara Lawn', 2110, 3, 'jazzcash', '4567', true, true, false],
  );
  assert.deepEqual([b!.storeId, b!.balance, b!.unsettledEntries, b!.payoutMethod, b!.hasPayoutDetails, b!.emailVerified], [STORE_B, -300, 1, null, false, false]);
  assert.equal(JSON.stringify(list).includes(ACCOUNT_NUMBER), false, 'the full account number is never in the list');
});

test('balances: a search narrows by store name, and a store with nothing open is not listed', async () => {
  seed();
  world.entry({ store: STORE_B, type: 'cod_commission', balanceEffect: -300 });
  assert.deepEqual((await listBalances({ page: 1, limit: 20, q: 'zara' })).docs.map((d) => d.storeId), [STORE_A]);
  assert.deepEqual((await listBalances({ page: 1, limit: 20, q: 'nomatch' })).docs, []);
  world.entries.length = 0;
  assert.equal((await listBalances({ page: 1, limit: 20 })).totalDocs, 0);
});

// ------------------------------------------------------------------------------------------------------------ create

test('a payout settles every open entry up to now, keeps only the last 4 of the account and tells the admin who paid', async () => {
  const entries = seed();
  const row = await createPayout(input(), ADMIN);
  assert.equal(row.status, 'paid');
  assert.deepEqual([row.amount, row.entryCount, row.method, row.reference, row.createdBy, row.storeName], [2110, 3, 'jazzcash', 'JC-778812', ADMIN, 'Zara Lawn']);
  assert.deepEqual(row.details, { method: 'jazzcash', accountTitle: 'Zara Khan', last4: '4567', bankName: null });
  assert.ok(row.paidAt !== null);
  for (const entry of entries) {
    assert.ok(entry.settledAt instanceof Date);
    assert.equal(String(entry.payoutId), row.id);
  }
  assert.equal(JSON.stringify(world.payouts).includes(ACCOUNT_NUMBER), false);
  assert.equal(JSON.stringify(row).includes(ACCOUNT_NUMBER), false);
  const audit = world.audits.find((a) => a.action === 'payout.create');
  assert.ok(audit);
  assert.equal(audit.actorId, 'admin:' + ADMIN);
  assert.equal(JSON.stringify(world.audits).includes(ACCOUNT_NUMBER), false);
  assert.equal((await listBalances({ page: 1, limit: 20 })).totalDocs, 0, 'nothing is left to pay');
  await settle();
});

test('a store without payout details cannot be paid', async () => {
  world.entry({ store: STORE_B, type: 'cod_commission', balanceEffect: 500 });
  const err = await refused(createPayout({ ...input(500), storeId: STORE_B }, ADMIN));
  assert.deepEqual([err.status, err.errorCode], [409, 'PAYOUT_NO_DETAILS']);
  assert.equal(world.payouts.length, 0);
  assert.ok(world.entries.every(free));
});

test('a seller with an unverified email cannot be paid (EMAIL_NOT_VERIFIED)', async () => {
  world.entry({ store: STORE_B, type: 'cod_commission', balanceEffect: 500 });
  world.stores[STORE_B]!.payoutDetails = { method: 'bank', accountTitle: 'Bilal Looms', accountNumber: 'PK36SCBL0000001123456702', bankName: 'Standard Chartered' };
  const err = await refused(createPayout({ ...input(500), storeId: STORE_B, method: 'bank' }, ADMIN));
  assert.deepEqual([err.status, err.errorCode], [403, 'EMAIL_NOT_VERIFIED']);
  assert.equal(world.payouts.length, 0);
  assert.ok(world.entries.every(free));
});

test('a payout by a method other than the saved one is refused with 422 PAYOUT_METHOD_MISMATCH', async () => {
  seed();
  const err = await refused(createPayout(input(2110, { method: 'bank' }), ADMIN));
  assert.deepEqual([err.status, err.errorCode], [422, 'PAYOUT_METHOD_MISMATCH']);
  assert.equal(world.payouts.length, 0);
  assert.ok(world.entries.every(free));
});

test('a negative or a zero balance cannot be paid: it carries forward', async () => {
  world.entry({ type: 'cod_commission', balanceEffect: -300 });
  let err = await refused(createPayout(input(1), ADMIN));
  assert.deepEqual([err.status, err.errorCode], [409, 'PAYOUT_NOTHING_TO_PAY']);
  world.entry({ type: 'card_sale', balanceEffect: 300 });
  err = await refused(createPayout(input(300), ADMIN));
  assert.deepEqual([err.status, err.errorCode], [409, 'PAYOUT_NOTHING_TO_PAY']);
  assert.equal(world.payouts.length, 0);
  assert.ok(world.entries.every(free), 'nothing was settled');
  assert.equal((await listBalances({ page: 1, limit: 20 })).docs[0]!.balance, 0);
});

test('an expectedBalance that is not the balance is a 409 to reload, and nothing is written', async () => {
  seed();
  const err = await refused(createPayout(input(2000), ADMIN));
  assert.deepEqual([err.status, err.errorCode], [409, 'PAYOUT_BALANCE_CHANGED']);
  assert.match(err.message, /[Rr]eload/);
  assert.equal(world.payouts.length, 0);
  assert.ok(world.entries.every(free));
  // The balance moves after the admin looked: the same request is refused too.
  world.entry({ type: 'card_sale', balanceEffect: 500 });
  assert.equal((await refused(createPayout(input(2110), ADMIN))).errorCode, 'PAYOUT_BALANCE_CHANGED');
});

test('two admins paying at once leave one payout, and no entry is claimed twice', async () => {
  seed();
  const results = await Promise.allSettled([createPayout(input(), ADMIN), createPayout(input(), '65a000000000000000000099')]);
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.ok(lost[0]!.reason instanceof HttpError);
  assert.equal(lost[0]!.reason.status, 409);
  const paid = world.payouts.filter((p) => p.status === 'paid');
  assert.equal(paid.length, 1);
  assert.equal(world.payouts.filter((p) => p.status === 'pending_settle').length, 0, 'nothing is left half done');
  assert.ok(world.entries.every((e) => String(e.payoutId) === String(paid[0]!._id)), 'every entry belongs to the one payout');
  await settle();
});

test('a claim that does not match what was shown releases exactly its own entries and marks the payout failed', async () => {
  seed();
  // An entry an earlier payout settled must stay settled.
  const older = world.entry({ type: 'card_sale', balanceEffect: 700, settledAt: new Date('2026-11-02T00:00:00Z'), payoutId: 'b0b0b0b0b0b0b0b0b0b0b0b0' });
  world.claimLimit = 1;
  const err = await refused(createPayout(input(), ADMIN));
  assert.deepEqual([err.status, err.errorCode], [409, 'PAYOUT_BALANCE_CHANGED']);
  assert.equal(world.payouts.length, 1);
  assert.equal(world.payouts[0]!.status, 'failed');
  assert.ok(typeof world.payouts[0]!.failedReason === 'string' && world.payouts[0]!.failedReason.length > 0);
  assert.ok(world.entries.filter((e) => e !== older).every(free), 'no entry stays claimed by a failed payout');
  assert.equal(older.payoutId, 'b0b0b0b0b0b0b0b0b0b0b0b0');
  assert.ok(older.settledAt instanceof Date);
});

// -------------------------------------------------------------------------------------------- a request that died

test('a payout left in pending_settle is in the admin list, blocks a second one, and finish settles it once', async () => {
  seed();
  world.crashBeforePaid = true;
  await assert.rejects(createPayout(input(), ADMIN), /died before the last step/);
  assert.equal(world.payouts.length, 1);
  assert.equal(world.payouts[0]!.status, 'pending_settle');
  assert.ok(world.entries.every((e) => String(e.payoutId) === String(world.payouts[0]!._id)), 'its entries are claimed');

  const history = await listPayouts({ page: 1, limit: 20 });
  assert.deepEqual(history.docs.map((d) => d.status), ['pending_settle']);

  // A sale made after the stuck payout's cutoff: it is not part of that payout.
  world.entry({ type: 'card_sale', balanceEffect: 500, createdAt: new Date('2026-11-11T00:00:00Z') });
  payoutDeps.now = () => new Date('2026-11-12T00:00:00.000Z');
  assert.equal((await refused(createPayout(input(500), ADMIN))).errorCode, 'PAYOUT_IN_PROGRESS');
  payoutDeps.now = () => NOW;

  const id = String(world.payouts[0]!._id);
  const finished = await finishPayout({ payoutId: id }, ADMIN);
  assert.equal(finished.status, 'paid');
  assert.equal(world.audits.filter((a) => a.action === 'payout.finish').length, 1);
  const again = await finishPayout({ payoutId: id }, ADMIN);
  assert.equal(again.status, 'paid');
  assert.equal(world.audits.filter((a) => a.action === 'payout.finish').length, 1, 'a repeat changes nothing and is not audited again');
  assert.equal(world.entries.filter((e) => String(e.payoutId) === id).length, 3);
  await settle();
  assert.equal(world.outbox.filter((m) => m.template === 'payout_paid').length, 1, 'one email, not two');
});

test('a request that died halfway through the claim is completed by finish', async () => {
  seed();
  world.claimCrashAfter = 1;
  await assert.rejects(createPayout(input(), ADMIN), /died while claiming/);
  assert.equal(world.payouts[0]!.status, 'pending_settle');
  assert.equal(world.entries.filter((e) => !free(e)).length, 1, 'only one entry was reached');
  const finished = await finishPayout({ payoutId: String(world.payouts[0]!._id) }, ADMIN);
  assert.equal(finished.status, 'paid');
  assert.equal(world.entries.filter((e) => String(e.payoutId) === finished.id).length, 3);
  await settle();
});

test('finish releases a stuck payout whose entries no longer add up, and none stays claimed', async () => {
  seed();
  world.crashBeforePaid = true;
  await assert.rejects(createPayout(input(), ADMIN));
  // Meanwhile a reopened entry that falls inside the cutoff is open again.
  world.entry({ type: 'reversal', reversesType: 'card_sale', balanceEffect: -250, createdAt: new Date('2026-11-03T00:00:00Z') });
  const finished = await finishPayout({ payoutId: String(world.payouts[0]!._id) }, ADMIN);
  assert.equal(finished.status, 'failed');
  assert.ok(world.entries.every(free), 'no entry stays claimed by a failed payout');
  assert.equal((await listBalances({ page: 1, limit: 20 })).docs[0]!.balance, 2110 - 250);
});

// -------------------------------------------------------------------------------------------------------------- void

test('void reopens the entries once: a repeat changes nothing, and a new payout keeps what it claimed', async () => {
  seed();
  const paid = await createPayout(input(), ADMIN);
  const voided = await voidPayout({ payoutId: paid.id, reason: 'Sent to the wrong account' }, ADMIN);
  assert.equal(voided.status, 'voided');
  assert.deepEqual([voided.voidReason, voided.voidedBy], ['Sent to the wrong account', ADMIN]);
  assert.ok(voided.voidedAt !== null);
  assert.ok(world.entries.every(free), 'the entries count in the balance again');
  assert.equal((await listBalances({ page: 1, limit: 20 })).docs[0]!.balance, 2110);

  await voidPayout({ payoutId: paid.id, reason: 'Sent to the wrong account' }, ADMIN);
  assert.equal(world.audits.filter((a) => a.action === 'payout.void').length, 1, 'a repeat is not audited again');

  const second = await createPayout(input(), ADMIN);
  assert.notEqual(second.id, paid.id);
  await voidPayout({ payoutId: paid.id, reason: 'Sent to the wrong account' }, ADMIN);
  assert.ok(world.entries.every((e) => String(e.payoutId) === second.id), 'voiding the old payout again does not free the new payout\'s entries');
  assert.equal(world.payouts.find((p) => String(p._id) === second.id)!.status, 'paid');
  await settle();
});

test('void refuses a failed payout and an unknown one, and finishes a stuck one first', async () => {
  seed();
  world.claimLimit = 1;
  await refused(createPayout(input(), ADMIN));
  world.claimLimit = null;
  const failedId = String(world.payouts[0]!._id);
  const err = await refused(voidPayout({ payoutId: failedId, reason: 'No reason' }, ADMIN));
  assert.deepEqual([err.status, err.errorCode], [409, 'PAYOUT_WRONG_STATE']);
  assert.equal((await refused(voidPayout({ payoutId: '65a0000000000000000fffff', reason: 'No reason' }, ADMIN))).status, 404);

  world.crashBeforePaid = true;
  await assert.rejects(createPayout(input(), ADMIN));
  const stuck = String(world.payouts.find((p) => p.status === 'pending_settle')!._id);
  const voided = await voidPayout({ payoutId: stuck, reason: 'Cleaning up a stuck payout' }, ADMIN);
  assert.equal(voided.status, 'voided');
  assert.ok(world.entries.every(free));
  await settle();
});

// ------------------------------------------------------------------------------------------------- reversal nets in

test('a reversal of an already settled entry is a new open row that nets into the next payout', async () => {
  world.entry({ type: 'card_sale', order: '65a0000000000000000a0001', balanceEffect: 1000, baseAmount: 1000 });
  world.entry({ type: 'card_commission', order: '65a0000000000000000a0001', balanceEffect: -40, baseAmount: 1000 });
  const first = await createPayout(input(960), ADMIN);
  assert.equal(first.amount, 960);

  // The order is refunded after it was paid out: two new open rows, the settled ones are not touched.
  world.entry({ type: 'reversal', reversesType: 'card_sale', order: '65a0000000000000000a0001', balanceEffect: -1000, baseAmount: 1000 });
  world.entry({ type: 'reversal', reversesType: 'card_commission', order: '65a0000000000000000a0001', balanceEffect: 40, baseAmount: 1000 });
  const owing = (await listBalances({ page: 1, limit: 20 })).docs[0]!;
  assert.deepEqual([owing.balance, owing.unsettledEntries], [-960, 2]);
  assert.equal((await refused(createPayout(input(1), ADMIN))).errorCode, 'PAYOUT_NOTHING_TO_PAY');
  assert.equal(world.payouts.find((p) => String(p._id) === first.id)!.status, 'paid');

  // The next sale nets the reversal off.
  world.entry({ type: 'card_sale', order: '65a0000000000000000a0002', balanceEffect: 3000, baseAmount: 3000 });
  world.entry({ type: 'card_commission', order: '65a0000000000000000a0002', balanceEffect: -120, baseAmount: 3000 });
  const second = await createPayout(input(1920), ADMIN);
  assert.deepEqual([second.amount, second.entryCount], [1920, 4]);
  assert.equal(world.entries.filter((e) => String(e.payoutId) === first.id).length, 2, 'the first payout keeps its own entries');
  await settle();
});

// -------------------------------------------------------------------------------------------------- full details (B5)

test('the full payout account goes to an admin only, is audited every time, and the audit never holds the number', async () => {
  const first = await readFullPayoutDetails({ storeId: STORE_A }, ADMIN);
  assert.deepEqual(first, { storeId: STORE_A, method: 'jazzcash', accountTitle: 'Zara Khan', accountNumber: ACCOUNT_NUMBER, bankName: null });
  await readFullPayoutDetails({ storeId: STORE_A }, ADMIN);
  const views = world.audits.filter((a) => a.action === 'payout_details_viewed');
  assert.equal(views.length, 2, 'every view is audited');
  assert.deepEqual([views[0]!.entity, views[0]!.entityId, views[0]!.actorId], ['store', STORE_A, 'admin:' + ADMIN]);
  assert.equal(JSON.stringify(world.audits).includes(ACCOUNT_NUMBER), false);
  assert.equal(JSON.stringify(world.audits).includes('4567'), false);
  for (const actor of ['seller', 'system', 'public'] as const) assert.throws(() => assertCan(actor, 'read', 'payoutDetails'), /may not read payoutDetails/);
});

test('if the view cannot be audited nothing is shown, and a store without details shows nothing and records nothing', async () => {
  world.auditFails = true;
  const err = await refused(readFullPayoutDetails({ storeId: STORE_A }, ADMIN));
  assert.equal(err.status, 503);
  assert.equal(err.message.includes(ACCOUNT_NUMBER), false);
  world.auditFails = false;
  const none = await refused(readFullPayoutDetails({ storeId: STORE_B }, ADMIN));
  assert.equal(none.status, 404);
  assert.equal(world.audits.length, 0);
  assert.equal((await refused(readFullPayoutDetails({ storeId: '65a0000000000000000fffff' }, ADMIN))).status, 404);
});

// ------------------------------------------------------------------------------------------------------------ emails

test('a payout queues the seller\'s email after the response, and a void queues another with the reason', async () => {
  seed();
  const paid = await createPayout(input(), ADMIN);
  await settle();
  const mail = world.outbox.find((m) => m.template === 'payout_paid');
  assert.ok(mail, 'payout_paid is queued');
  assert.equal(mail.to, 'zara@example.com');
  assert.equal(mail.dedupeKey, 'payout_paid:' + paid.id);
  for (const part of ['Rs. 2,110', 'JazzCash', 'JC-778812', 'Zara Lawn', 'https://seller.markazify.com/s/' + STORE_A + '/earnings']) assert.ok(mail.bodyText.includes(part), part);
  assert.equal(mail.bodyText.includes(ACCOUNT_NUMBER), false);

  await voidPayout({ payoutId: paid.id, reason: 'Sent to the wrong <b>account</b>' }, ADMIN);
  await settle();
  const voidMail = world.outbox.find((m) => m.template === 'payout_voided');
  assert.ok(voidMail, 'payout_voided is queued');
  assert.equal(voidMail.to, 'zara@example.com');
  assert.ok(voidMail.bodyText.includes('Sent to the wrong <b>account</b>'));
  assert.equal(voidMail.bodyHtml.includes('<b>account</b>'), false, 'the reason is escaped in HTML');

  await voidPayout({ payoutId: paid.id, reason: 'Sent to the wrong account' }, ADMIN);
  await settle();
  assert.equal(world.outbox.filter((m) => m.template === 'payout_voided').length, 1, 'a repeated void sends no second email');
});

test('the emails are best effort: no address, no email, and a repeated send is a no-op', async () => {
  world.users[OWNER_A]!.email = '';
  await sendPayoutPaid(STORE_A, { id: 'p1', amount: 12500, method: 'bank', reference: 'R-1' });
  await sendPayoutVoided(STORE_A, { id: 'p1', amount: 12500, method: 'bank', reference: 'R-1', voidReason: 'Wrong amount' });
  assert.equal(world.outbox.length, 0);
  world.users[OWNER_A]!.email = 'zara@example.com';
  await sendPayoutPaid(STORE_A, { id: 'p1', amount: 12500, method: 'bank', reference: 'R-1' });
  await sendPayoutPaid(STORE_A, { id: 'p1', amount: 12500, method: 'bank', reference: 'R-1' });
  assert.equal(world.outbox.length, 1);
  assert.ok(world.outbox[0]!.bodyText.includes('Bank transfer'));
});

// ------------------------------------------------------------------------------------------------ the signed routes

const signed = (method: 'GET' | 'POST', path: string, body?: unknown, secret = MOD_SECRET): NextRequest => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return new NextRequest('http://seller.test' + path, {
    method,
    headers: internalRequestHeaders(secret, { method, path, adminId: 'admin-1', body: raw }),
    ...(body === undefined ? {} : { body: raw }),
  });
};

test('the internal payout routes answer only to the admin backend\'s signature', async () => {
  seed();
  const balances = (await import('../src/app/api/internal/payouts/balances/route')).GET;
  const root = await import('../src/app/api/internal/payouts/route');
  const details = (await import('../src/app/api/internal/payouts/details/route')).POST;

  const ok = await balances(signed('GET', '/api/internal/payouts/balances?page=1'));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { docs: unknown[] }).docs.length, 1);

  assert.equal((await balances(new NextRequest('http://seller.test/api/internal/payouts/balances'))).status, 401, 'no signature');
  assert.equal((await balances(signed('GET', '/api/internal/payouts/balances', undefined, 'z'.repeat(40)))).status, 401, 'wrong secret');
  const asSeller = new NextRequest('http://seller.test/api/internal/payouts/balances', { headers: { authorization: 'Bearer ' + sellerToken } });
  assert.equal((await balances(asSeller)).status, 401, 'a seller session means nothing here');
  const detailsAsSeller = new NextRequest('http://seller.test/api/internal/payouts/details', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + sellerToken },
    body: JSON.stringify({ storeId: STORE_A }),
  });
  assert.equal((await details(detailsAsSeller)).status, 401, 'a seller cannot read the full account');
  assert.equal(world.audits.length, 0);

  const shown = await details(signed('POST', '/api/internal/payouts/details', { storeId: STORE_A }));
  assert.equal(shown.status, 200);
  assert.equal(((await shown.json()) as { accountNumber: string }).accountNumber, ACCOUNT_NUMBER);
  assert.equal(world.audits.filter((a) => a.action === 'payout_details_viewed').length, 1);

  const bad = await root.POST(signed('POST', '/api/internal/payouts', { storeId: STORE_A, expectedBalance: 0, method: 'jazzcash', reference: 'R' }));
  assert.equal(bad.status, 422, 'a zero amount is refused before anything else');
  const made = await root.POST(signed('POST', '/api/internal/payouts', input()));
  assert.equal(made.status, 200);
  assert.equal(((await made.json()) as { status: string }).status, 'paid');
  const listed = await root.GET(signed('GET', '/api/internal/payouts?status=paid'));
  assert.equal(((await listed.json()) as { totalDocs: number }).totalDocs, 1);
  await settle();
});
