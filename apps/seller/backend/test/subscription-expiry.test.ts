import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { AuditLog, PlatformSettingsModel, Subscription, SubscriptionPlanModel } from '@/lib/services';
import { expiryJobResponseSchema } from '../../../../packages/contracts/src/subscription';
import { EXPIRY_BATCH, REMINDER_DAYS, expiryFilter, needsReminder, planTransition, runSubscriptionExpiry, type ExpiryMail, type SubRow } from '../src/lib/subscription-expiry';

// Sprint 6 EP-14.US02 (D-118): the expiry job. Subscriptions are in memory with a compare-and-set that emulates the database; no database.

const CRON = 'c'.repeat(32);
const NOW = new Date('2026-11-20T10:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);
const SubModel = Subscription as any;
const AuditModel = AuditLog as any;
const SettingsModel = PlatformSettingsModel as any;

let rows: Array<Record<string, any>>;
let audits: Array<Record<string, any>>;
let writes: Array<{ filter: any; update: any }>;
let settingsDoc: Record<string, unknown> | null;
let failUpdateFor: string | null;
let restore: () => void = () => {};
let expirePOST: (r: NextRequest) => Promise<Response>;
let expireGET: (r: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  const route = await import('../src/app/api/internal/subscriptions/expire/route');
  expirePOST = route.POST;
  expireGET = route.GET;
});

const sub = (id: string, status: string, extra: Record<string, any> = {}): Record<string, any> => ({
  _id: id,
  seller: 'seller-' + id,
  planKey: 'growth',
  status,
  revision: 0,
  currentPeriodEnd: null,
  graceUntil: null,
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  ...extra,
});

const chain = (value: () => unknown) => {
  const q: any = { select: () => q, sort: () => q, limit: () => q, lean: async () => value() };
  return q;
};

/** What the expiry query asks for, evaluated against the rows: the same three groups. */
function wanted(row: Record<string, any>): boolean {
  if (row.status === 'trial') return row.trialEndsAt !== null && row.trialEndsAt <= NOW;
  if (row.status === 'active' || row.status === 'cancelled') return row.currentPeriodEnd !== null && row.currentPeriodEnd <= NOW;
  return row.status === 'grace';
}

beforeEach(() => {
  rows = [];
  audits = [];
  writes = [];
  settingsDoc = null;
  failUpdateFor = null;
  process.env.OUTBOX_CRON_SECRET = CRON;
  const saved = { connect: (mongoose as any).connect, find: SubModel.find, update: SubModel.findOneAndUpdate, audit: AuditModel.create, settings: SettingsModel.findOne };
  (mongoose as any).connect = async () => mongoose;
  SubModel.find = () => chain(() => rows.filter(wanted).map((row) => ({ ...row })));
  SubModel.findOneAndUpdate = (filter: any, update: any) => {
    writes.push({ filter, update });
    return chain(() => {
      if (failUpdateFor === String(filter._id)) throw new Error('write failed');
      const row = rows.find((candidate) => candidate._id === filter._id);
      if (!row || row.status !== filter.status) return null;
      const revision = row.revision ?? 0;
      const matches = typeof filter.revision === 'object' ? filter.revision.$in.includes(revision) : filter.revision === revision;
      if (!matches) return null;
      Object.assign(row, update.$set);
      row.revision = revision + (update.$inc?.revision ?? 0);
      return { _id: row._id };
    });
  };
  AuditModel.create = async (doc: Record<string, any>) => {
    audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };
  SettingsModel.findOne = () => chain(() => settingsDoc);
  restore = () => {
    (mongoose as any).connect = saved.connect;
    SubModel.find = saved.find;
    SubModel.findOneAndUpdate = saved.update;
    AuditModel.create = saved.audit;
    SettingsModel.findOne = saved.settings;
    delete process.env.OUTBOX_CRON_SECRET;
  };
});

afterEach(() => restore());

// ---------------------------------------------------------------------------------------------------------------- the pure rule

test('planTransition: a trial that ended without payment expires; one still running, or with no date, does not move', () => {
  assert.deepEqual(planTransition(sub('t', 'trial', { trialEndsAt: at(-1) }) as SubRow, NOW, 7)?.kind, 'trialToExpired');
  assert.deepEqual(planTransition(sub('t', 'trial', { trialEndsAt: NOW }) as SubRow, NOW, 7)?.kind, 'trialToExpired', 'at the end instant it is over');
  assert.equal(planTransition(sub('t', 'trial', { trialEndsAt: at(2) }) as SubRow, NOW, 7), null);
  assert.equal(planTransition(sub('t', 'trial') as SubRow, NOW, 7), null);
});

test('planTransition: active at its period end goes to grace with graceUntil = period end + graceDays; before it, nothing', () => {
  const move = planTransition(sub('a', 'active', { currentPeriodEnd: at(-1) }) as SubRow, NOW, 7)!;
  assert.deepEqual([move.kind, move.from, move.to, move.set.status], ['activeToGrace', 'active', 'grace', 'grace']);
  assert.equal((move.set.graceUntil as Date).getTime(), at(6).getTime());
  assert.equal((planTransition(sub('a', 'active', { currentPeriodEnd: at(-1) }) as SubRow, NOW, 3)!.set.graceUntil as Date).getTime(), at(2).getTime());
  assert.equal(planTransition(sub('a', 'active', { currentPeriodEnd: at(1) }) as SubRow, NOW, 7), null);
  assert.equal(planTransition(sub('a', 'active') as SubRow, NOW, 7), null, 'no end date: nothing to pass');
});

test('planTransition: grace at graceUntil expires; without a stored end it is the period end plus graceDays', () => {
  assert.equal(planTransition(sub('g', 'grace', { currentPeriodEnd: at(-9), graceUntil: at(-1) }) as SubRow, NOW, 7)?.kind, 'graceToExpired');
  assert.equal(planTransition(sub('g', 'grace', { currentPeriodEnd: at(-9), graceUntil: at(1) }) as SubRow, NOW, 7), null);
  assert.equal(planTransition(sub('g', 'grace', { currentPeriodEnd: at(-8) }) as SubRow, NOW, 7)?.kind, 'graceToExpired');
  assert.equal(planTransition(sub('g', 'grace', { currentPeriodEnd: at(-3) }) as SubRow, NOW, 7), null);
  assert.equal(planTransition(sub('g', 'grace') as SubRow, NOW, 7), null);
});

test('planTransition: a cancelled subscription expires at the period end, and an active one set to cancel skips grace', () => {
  assert.equal(planTransition(sub('c', 'cancelled', { currentPeriodEnd: at(-1) }) as SubRow, NOW, 7)?.kind, 'cancelledToExpired');
  assert.equal(planTransition(sub('c', 'cancelled', { currentPeriodEnd: at(3) }) as SubRow, NOW, 7), null);
  const skipped = planTransition(sub('a', 'active', { currentPeriodEnd: at(-1), cancelAtPeriodEnd: true }) as SubRow, NOW, 7)!;
  assert.deepEqual([skipped.kind, skipped.to], ['cancelledToExpired', 'expired']);
});

test('planTransition: expired and unknown statuses never move, and the move is only a status (and the grace date)', () => {
  for (const status of ['expired', 'paused', '']) assert.equal(planTransition(sub('x', status, { currentPeriodEnd: at(-30) }) as SubRow, NOW, 7), null, status);
  assert.deepEqual(planTransition(sub('t', 'trial', { trialEndsAt: at(-1) }) as SubRow, NOW, 7)!.set, { status: 'expired' });
});

test('expiryFilter is a compare-and-set on the status and the revision read; a row with no revision matches 0', () => {
  assert.deepEqual(expiryFilter({ _id: 'a', status: 'active', revision: 3 }, 'active'), { _id: 'a', status: 'active', revision: 3 });
  assert.deepEqual(expiryFilter({ _id: 'a', status: 'active' }, 'active'), { _id: 'a', status: 'active', revision: { $in: [0, null] } });
});

// -------------------------------------------------------------------------------------------------------------- the job, dry run

test('a dry run (the default) counts what would move and writes nothing: no update, no audit line', async () => {
  rows = [
    sub('1', 'trial', { trialEndsAt: at(-2) }),
    sub('2', 'active', { currentPeriodEnd: at(-1) }),
    sub('3', 'grace', { currentPeriodEnd: at(-10), graceUntil: at(-3) }),
    sub('4', 'cancelled', { currentPeriodEnd: at(-1) }),
    sub('5', 'active', { currentPeriodEnd: at(5) }),
  ];
  const result = await runSubscriptionExpiry({ now: NOW });
  assert.deepEqual(result, { dryRun: true, scanned: 4, trialToExpired: 1, activeToGrace: 1, graceToExpired: 1, cancelledToExpired: 1, downgraded: 0, remindersQueued: 0, expiredNoticesQueued: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length + audits.length, 0);
  assert.deepEqual(rows.map((row) => row.status), ['trial', 'active', 'grace', 'cancelled', 'active']);
  assert.equal(expiryJobResponseSchema.safeParse(result).success, true);
});

test('apply: false and anything but true is still a dry run', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-2) })];
  for (const apply of [undefined, false]) {
    const result = await runSubscriptionExpiry({ now: NOW, apply });
    assert.equal(result.dryRun, true);
  }
  assert.equal(rows[0]!.status, 'trial');
});

// --------------------------------------------------------------------------------------------------------------- the job, apply

test('apply: trial to expired when no payment, active to grace at the period end, grace to expired at graceUntil, cancelled to expired', async () => {
  rows = [
    sub('1', 'trial', { trialEndsAt: at(-2) }),
    sub('2', 'active', { currentPeriodEnd: at(-1) }),
    sub('3', 'grace', { currentPeriodEnd: at(-10), graceUntil: at(-3) }),
    sub('4', 'cancelled', { currentPeriodEnd: at(-1) }),
    sub('5', 'active', { currentPeriodEnd: at(5) }),
  ];
  const result = await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.deepEqual(result, { dryRun: false, scanned: 4, trialToExpired: 1, activeToGrace: 1, graceToExpired: 1, cancelledToExpired: 1, downgraded: 0, remindersQueued: 0, expiredNoticesQueued: 0, skipped: 0, failed: 0 });
  assert.deepEqual(rows.map((row) => row.status), ['expired', 'grace', 'expired', 'expired', 'active']);
  assert.equal(rows[1]!.graceUntil.getTime(), at(6).getTime(), 'graceDays defaults to 7');
  assert.deepEqual(rows.map((row) => row.revision), [1, 1, 1, 1, 0], 'every move advances the revision, an untouched row does not');
});

test('graceDays comes from the platform setting', async () => {
  settingsDoc = { graceDays: 14 };
  rows = [sub('2', 'active', { currentPeriodEnd: at(-1) })];
  await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.equal(rows[0]!.graceUntil.getTime(), at(13).getTime());
  settingsDoc = { graceDays: 0 };
  rows = [sub('3', 'active', { currentPeriodEnd: at(-1) })];
  await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.equal(rows[0]!.graceUntil.getTime(), at(-1).getTime(), 'a 0 day grace ends the moment the period does (the next run expires it)');
});

test('one step per run: a missed subscription goes active to grace, then grace to expired on the next run, and a third run finds nothing', async () => {
  rows = [sub('1', 'active', { currentPeriodEnd: at(-40) })];
  const first = await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.deepEqual([first.activeToGrace, first.graceToExpired], [1, 0]);
  const second = await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.deepEqual([second.activeToGrace, second.graceToExpired], [0, 1]);
  assert.equal(rows[0]!.status, 'expired');
  const third = await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.deepEqual([third.scanned, third.activeToGrace + third.graceToExpired + third.trialToExpired + third.cancelledToExpired], [0, 0]);
});

test('idempotent: running the same moment twice changes nothing the second time', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-2) }), sub('2', 'cancelled', { currentPeriodEnd: at(-1) })];
  await runSubscriptionExpiry({ now: NOW, apply: true });
  const snapshot = JSON.stringify(rows);
  const again = await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.equal(again.trialToExpired + again.cancelledToExpired, 0);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('the write is a compare-and-set on the status and revision read: a row changed in between is skipped, not overwritten, and has no audit line', async () => {
  rows = [sub('1', 'active', { currentPeriodEnd: at(-1), revision: 2 }), sub('2', 'trial', { trialEndsAt: at(-1) })];
  const find = SubModel.find;
  // An admin marks the first one paid between the read and the write: its status and revision move.
  SubModel.find = () => {
    const snapshot = rows.filter(wanted).map((row) => ({ ...row }));
    rows[0]!.status = 'active';
    rows[0]!.revision = 3;
    return chain(() => snapshot);
  };
  const result = await runSubscriptionExpiry({ now: NOW, apply: true });
  SubModel.find = find;
  assert.deepEqual([result.skipped, result.activeToGrace, result.trialToExpired], [1, 0, 1]);
  assert.equal(rows[0]!.status, 'active');
  assert.equal(rows[0]!.graceUntil, null);
  assert.deepEqual(writes[0]!.filter, { _id: '1', status: 'active', revision: 2 });
  assert.equal(audits.length, 1, 'only the change that happened');
});

test('one audit line per change, with the seller, the plan, from, to and when; none for a skipped or a dry run', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) }), sub('2', 'active', { currentPeriodEnd: at(-1) })];
  await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.equal(audits.length, 2);
  assert.deepEqual(audits.map((a) => a.action), ['subscription.expiry', 'subscription.expiry']);
  assert.deepEqual(audits.map((a) => [a.entity, a.entityId, a.actorId]), [['subscription', '1', 'system:expiry'], ['subscription', '2', 'system:expiry']]);
  assert.deepEqual(audits[1]!.details, { seller: 'seller-2', planKey: 'growth', from: 'active', to: 'grace', at: NOW.toISOString() });
});

test('a failed write counts as failed and the others still run; a failed audit line does not undo the change', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) }), sub('2', 'trial', { trialEndsAt: at(-1) })];
  failUpdateFor = '1';
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await runSubscriptionExpiry({ now: NOW, apply: true });
    assert.deepEqual([result.failed, result.trialToExpired], [1, 1]);
    assert.deepEqual(rows.map((row) => row.status), ['trial', 'expired']);

    failUpdateFor = null;
    AuditModel.create = async () => {
      throw new Error('audit down');
    };
    const again = await runSubscriptionExpiry({ now: NOW, apply: true });
    assert.equal(again.trialToExpired, 1);
    assert.equal(rows[0]!.status, 'expired');
  } finally {
    console.error = quiet;
  }
});

test('nothing is ever deleted: a lapsed subscription stays as a row with its plan key', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) })];
  await runSubscriptionExpiry({ now: NOW, apply: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.planKey, 'growth');
  assert.equal(typeof EXPIRY_BATCH, 'number');
});

// ------------------------------------------------------------------------------------------------------------------- the route

const post = (body?: unknown, secret: string | null = CRON): NextRequest =>
  new NextRequest('http://seller.test/api/internal/subscriptions/expire', {
    method: 'POST',
    headers: { ...(secret === null ? {} : { 'x-cron-secret': secret }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

test('route: closed without the secret, with a wrong one, and when none is set; nothing is read or written', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) })];
  assert.equal((await expirePOST(post({ apply: true }, null))).status, 401);
  assert.equal((await expirePOST(post({ apply: true }, 'wrong'.repeat(8)))).status, 401);
  delete process.env.OUTBOX_CRON_SECRET;
  assert.equal((await expirePOST(post({ apply: true }))).status, 401);
  assert.equal(rows[0]!.status, 'trial');
  assert.equal(writes.length, 0);
});

test('route: an empty body, {} and { apply: false } are a dry run; only { apply: true } applies', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) })];
  for (const body of [undefined, {}, { apply: false }]) {
    const res = await expirePOST(post(body));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { dryRun: boolean; trialToExpired: number };
    assert.deepEqual([json.dryRun, json.trialToExpired], [true, 1]);
  }
  assert.equal(rows[0]!.status, 'trial');
  const applied = (await (await expirePOST(post({ apply: true }))).json()) as { dryRun: boolean; trialToExpired: number };
  assert.deepEqual([applied.dryRun, applied.trialToExpired], [false, 1]);
  assert.equal(rows[0]!.status, 'expired');
});

test('route: GET is always a dry run, even with ?apply=true', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) })];
  const res = await expireGET(new NextRequest('http://seller.test/api/internal/subscriptions/expire?apply=true', { headers: { 'x-cron-secret': CRON } }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { dryRun: boolean }).dryRun, true);
  assert.equal(rows[0]!.status, 'trial');
  assert.equal((await expireGET(new NextRequest('http://seller.test/api/internal/subscriptions/expire'))).status, 401);
});

test('route: a body that is not { apply?: boolean } is a 400 and nothing runs', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) })];
  for (const body of [{ apply: 'yes' }, { apply: 1 }, { apply: true, force: true }, [true], 'not json']) {
    assert.equal((await expirePOST(post(body))).status, 400, JSON.stringify(body));
  }
  assert.equal(rows[0]!.status, 'trial');
  assert.equal(writes.length, 0);
});

test('route: the answer is counts only, and the Authorization: Bearer form of the secret works too', async () => {
  rows = [sub('1', 'trial', { trialEndsAt: at(-1) })];
  const res = await expirePOST(
    new NextRequest('http://seller.test/api/internal/subscriptions/expire', { method: 'POST', headers: { authorization: 'Bearer ' + CRON } }),
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(json).sort(), ['activeToGrace', 'cancelledToExpired', 'downgraded', 'dryRun', 'expiredNoticesQueued', 'failed', 'graceToExpired', 'remindersQueued', 'scanned', 'skipped', 'trialToExpired']);
  assert.equal(expiryJobResponseSchema.safeParse(json).success, true);
});

// ------------------------------------------------------------------------------------------- Sprint 6 (S6-B4): downgrade and emails

const PlanModel = SubscriptionPlanModel as any;

test('planTransition: a pending downgrade to Free applies at the period end: Free, active, no end date, nothing pending', () => {
  const move = planTransition(sub('a', 'active', { currentPeriodEnd: at(-1), pendingPlanKey: 'free' }) as SubRow, NOW, 7, { key: 'free', free: true })!;
  assert.deepEqual([move.kind, move.from, move.to], ['downgradeToFree', 'active', 'active']);
  assert.deepEqual(move.set, { planKey: 'free', status: 'active', periodStart: at(-1), currentPeriodEnd: null, graceUntil: null, trialEndsAt: null, cancelAtPeriodEnd: false, pendingPlanKey: null });
});

test('planTransition: a pending downgrade to a cheaper paid plan switches the plan and starts its grace; the seller pays its price to keep it', () => {
  const move = planTransition(sub('a', 'active', { currentPeriodEnd: at(-1), pendingPlanKey: 'starter' }) as SubRow, NOW, 7, { key: 'starter', free: false })!;
  assert.deepEqual([move.kind, move.to, move.set.planKey, move.set.status, move.set.pendingPlanKey], ['downgradeToPaid', 'grace', 'starter', 'grace', null]);
  assert.equal((move.set.graceUntil as Date).getTime(), at(6).getTime());
});

test('planTransition: cancel wins over a pending downgrade; a target that is not usable is ignored; before the period end nothing moves', () => {
  assert.equal(planTransition(sub('a', 'active', { currentPeriodEnd: at(-1), cancelAtPeriodEnd: true, pendingPlanKey: 'free' }) as SubRow, NOW, 7, { key: 'free', free: true })?.kind, 'cancelledToExpired');
  assert.equal(planTransition(sub('a', 'active', { currentPeriodEnd: at(-1), pendingPlanKey: 'gone' }) as SubRow, NOW, 7, null)?.kind, 'activeToGrace');
  assert.equal(planTransition(sub('a', 'active', { currentPeriodEnd: at(-1), pendingPlanKey: 'growth' }) as SubRow, NOW, 7, { key: 'growth', free: false })?.kind, 'activeToGrace', 'the plan it is already on');
  assert.equal(planTransition(sub('a', 'active', { currentPeriodEnd: at(1), pendingPlanKey: 'free' }) as SubRow, NOW, 7, { key: 'free', free: true }), null);
});

test('needsReminder: active, ending within 7 days, not leaving and not moving down', () => {
  assert.equal(REMINDER_DAYS, 7);
  assert.equal(needsReminder(sub('a', 'active', { currentPeriodEnd: at(3) }) as SubRow, NOW), true);
  assert.equal(needsReminder(sub('a', 'active', { currentPeriodEnd: at(7) }) as SubRow, NOW), true, 'exactly 7 days is inside');
  assert.equal(needsReminder(sub('a', 'active', { currentPeriodEnd: at(8) }) as SubRow, NOW), false);
  assert.equal(needsReminder(sub('a', 'active', { currentPeriodEnd: at(0) }) as SubRow, NOW), false, 'already over: the job moves it');
  assert.equal(needsReminder(sub('a', 'active', { currentPeriodEnd: at(3), cancelAtPeriodEnd: true }) as SubRow, NOW), false);
  assert.equal(needsReminder(sub('a', 'active', { currentPeriodEnd: at(3), pendingPlanKey: 'free' }) as SubRow, NOW), false);
  for (const status of ['trial', 'grace', 'expired', 'cancelled']) assert.equal(needsReminder(sub('a', status, { currentPeriodEnd: at(3) }) as SubRow, NOW), false, status);
  assert.equal(needsReminder(sub('a', 'active') as SubRow, NOW), false, 'no end date');
});

/** A find that answers the two queries of the job from the rows: the due ones, and the ones ending within 7 days. */
function routedFind(): void {
  SubModel.find = (filter: any) => {
    if (filter.$or) return chain(() => rows.filter(wanted).map((row) => ({ ...row })));
    const { $gt, $lte } = filter.currentPeriodEnd;
    return chain(() => rows.filter((row) => row.status === filter.status && row.currentPeriodEnd > $gt && row.currentPeriodEnd <= $lte).map((row) => ({ ...row })));
  };
}

function recorder(): { mail: ExpiryMail; sent: string[] } {
  const seen = new Set<string>();
  const sent: string[] = [];
  const send = (kind: string) => async (fields: any) => {
    const key = kind + ':' + fields.subscriptionId + ':' + fields.periodEnd.getTime();
    sent.push(key);
    if (seen.has(key)) return { outcome: 'duplicate' as const, id: null };
    seen.add(key);
    return { outcome: 'queued' as const, id: key };
  };
  return { mail: { expiring: send('expiring'), expired: send('expired') }, sent };
}

test('the job applies a pending downgrade to Free: one audit line naming the new plan, one count, no email (nothing ended badly)', async () => {
  rows = [sub('1', 'active', { currentPeriodEnd: at(-1), pendingPlanKey: 'free' })];
  const savedFind = PlanModel.find;
  PlanModel.find = () => chain(() => [{ key: 'free', priceRs: 0, isActive: true }]);
  const { mail, sent } = recorder();
  try {
    const result = await runSubscriptionExpiry({ now: NOW, apply: true, mail });
    assert.deepEqual([result.downgraded, result.activeToGrace, result.cancelledToExpired], [1, 0, 0]);
    assert.deepEqual([rows[0]!.planKey, rows[0]!.status, rows[0]!.currentPeriodEnd, rows[0]!.pendingPlanKey, rows[0]!.revision], ['free', 'active', null, null, 1]);
    assert.deepEqual(audits.map((a) => a.details), [{ seller: 'seller-1', planKey: 'growth', from: 'active', to: 'active', newPlanKey: 'free', at: NOW.toISOString() }]);
    assert.deepEqual(sent, []);
  } finally {
    PlanModel.find = savedFind;
  }
});

test('the job applies a pending downgrade to a cheaper paid plan as grace on that plan; a dry run counts it and writes nothing', async () => {
  rows = [sub('1', 'active', { currentPeriodEnd: at(-1), pendingPlanKey: 'starter' })];
  const savedFind = PlanModel.find;
  PlanModel.find = () => chain(() => [{ key: 'starter', priceRs: 900, isActive: true }]);
  try {
    const dry = await runSubscriptionExpiry({ now: NOW, mail: recorder().mail });
    assert.deepEqual([dry.downgraded, writes.length], [1, 0]);
    await runSubscriptionExpiry({ now: NOW, apply: true, mail: recorder().mail });
    assert.deepEqual([rows[0]!.planKey, rows[0]!.status, rows[0]!.pendingPlanKey], ['starter', 'grace', null]);
    assert.equal(rows[0]!.graceUntil.getTime(), at(6).getTime());
  } finally {
    PlanModel.find = savedFind;
  }
});

test('a pending downgrade to an archived or missing plan is ignored: the subscription goes to grace as usual', async () => {
  rows = [sub('1', 'active', { currentPeriodEnd: at(-1), pendingPlanKey: 'old' })];
  const savedFind = PlanModel.find;
  PlanModel.find = () => chain(() => [{ key: 'old', priceRs: 100, isActive: false }]);
  try {
    const result = await runSubscriptionExpiry({ now: NOW, apply: true, mail: recorder().mail });
    assert.deepEqual([result.downgraded, result.activeToGrace], [0, 1]);
    assert.equal(rows[0]!.planKey, 'growth');
  } finally {
    PlanModel.find = savedFind;
  }
});

test('the 7 day reminder is queued ONCE per subscription and period, however often the job runs', async () => {
  rows = [sub('1', 'active', { currentPeriodEnd: at(3) }), sub('2', 'active', { currentPeriodEnd: at(20) }), sub('3', 'active', { currentPeriodEnd: at(2), cancelAtPeriodEnd: true }), sub('4', 'active', { currentPeriodEnd: at(2), pendingPlanKey: 'free' })];
  routedFind();
  const { mail, sent } = recorder();
  const first = await runSubscriptionExpiry({ now: NOW, apply: true, mail });
  assert.deepEqual([first.remindersQueued, sent], [1, ['expiring:1:' + at(3).getTime()]]);
  const second = await runSubscriptionExpiry({ now: new Date(NOW.getTime() + 3600_000), apply: true, mail });
  assert.equal(second.remindersQueued, 0, 'the outbox said duplicate');
  // A renewal moves the period end: the next period has its own key.
  rows[0]!.currentPeriodEnd = at(33);
  const later = await runSubscriptionExpiry({ now: at(28), apply: true, mail });
  assert.equal(later.remindersQueued, 1);
  assert.equal(new Set(sent).size, 2);
});

test('a dry run counts the reminders that would go out and sends none', async () => {
  rows = [sub('1', 'active', { currentPeriodEnd: at(3) })];
  routedFind();
  const { mail, sent } = recorder();
  const result = await runSubscriptionExpiry({ now: NOW, mail });
  assert.deepEqual([result.dryRun, result.remindersQueued, sent.length], [true, 1, 0]);
});

test('every move to expired queues the expired email once; the move to grace does not; a failing email changes nothing', async () => {
  rows = [
    sub('1', 'trial', { trialEndsAt: at(-2) }),
    sub('2', 'grace', { currentPeriodEnd: at(-10), graceUntil: at(-3) }),
    sub('3', 'cancelled', { currentPeriodEnd: at(-1) }),
    sub('4', 'active', { currentPeriodEnd: at(-1) }),
    sub('5', 'active', { currentPeriodEnd: at(-1), cancelAtPeriodEnd: true }),
  ];
  routedFind();
  const { mail, sent } = recorder();
  const result = await runSubscriptionExpiry({ now: NOW, apply: true, mail });
  assert.equal(result.expiredNoticesQueued, 4, 'the trial, the grace, the cancelled and the cancel-at-end one: 4 moves to expired');
  assert.deepEqual(sent.filter((key) => key.startsWith('expired:')).map((key) => key.split(':')[1]).sort(), ['1', '2', '3', '5']);
  assert.equal(rows[3]!.status, 'grace', 'active to grace sends nothing');
  const again = await runSubscriptionExpiry({ now: NOW, apply: true, mail });
  assert.equal(again.expiredNoticesQueued, 0, 'a second run finds nothing to send');
});

test('the expired email names the period that ended (the key), and a mail that throws is logged and the move stands', async () => {
  rows = [sub('1', 'grace', { currentPeriodEnd: at(-10), graceUntil: at(-3) })];
  routedFind();
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await runSubscriptionExpiry({
      now: NOW,
      apply: true,
      mail: {
        expiring: async () => null,
        expired: async () => {
          throw new Error('outbox down');
        },
      },
    });
    assert.deepEqual([result.graceToExpired, result.expiredNoticesQueued, result.failed], [1, 0, 0]);
    assert.equal(rows[0]!.status, 'expired');
  } finally {
    console.error = quiet;
  }
});
