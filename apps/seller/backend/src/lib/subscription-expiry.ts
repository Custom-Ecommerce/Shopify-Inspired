import type { EnqueueResult } from '@markaz/notifications';
import { databaseReady } from '@/lib/notifications';
import { readPlanSettings, DEFAULT_GRACE_DAYS } from '@/lib/platform-settings';
import { Subscription, SubscriptionPlanModel, writeAuditLog } from '@/lib/services';
import { guarded, sendSubscriptionExpired, sendSubscriptionExpiring, type SubscriptionMailFields } from '@/lib/subscription-emails';

/**
 * Sprint 6 EP-14.US02 (D-118): the expiry job. It moves a subscription's STORED status along with the calendar, so the admin console and the
 * reports say what the seller is on. (The limits never wait for it: lib/plan.ts works the effective status out from the dates on every read.)
 *
 *   trial       -> expired   trialEndsAt has passed and nothing was paid
 *   active      -> grace     currentPeriodEnd has passed; graceUntil = currentPeriodEnd + graceDays (the platform setting, default 7)
 *   active      -> expired   currentPeriodEnd has passed and the subscription was set to cancel at the period end (no grace)
 *   grace       -> expired   graceUntil has passed
 *   cancelled   -> expired   currentPeriodEnd has passed
 *
 * Sprint 6 (S6-B4): a downgrade the seller asked for (pendingPlanKey) is applied when the period ends, and cancel wins over it:
 *
 *   active (pending Free)   -> active    the plan becomes Free with no end date; nothing is owed
 *   active (pending paid)   -> grace     the plan becomes the cheaper one; its limits apply for graceDays, and a payment of its price keeps it
 *
 * The same run queues two emails through the outbox, each ONCE (the dedupe key names the subscription and the period): "ending in 7 days" for an
 * active subscription whose period ends within 7 days (not for one set to cancel or to downgrade), and "expired" for every move to expired.
 *
 * One step per run: a subscription the job missed for weeks reaches `expired` over two runs, never in a way that skips the audit trail of the
 * step. Each move is a compare-and-set on the status and the revision that were read, so two runs (or an admin editing at the same moment) cannot
 * both win: the loser counts as skipped. A run is a DRY RUN unless it is told to apply; it writes nothing then. Every applied move leaves one audit
 * line. Nothing is ever deleted: expired means the Free limits, not a removed subscription.
 */

const DAY_MS = 86_400_000;
/** The reminder goes out when the period ends within this many days. */
export const REMINDER_DAYS = 7;
/** At most this many subscriptions per run (oldest first); the next run takes the rest. */
export const EXPIRY_BATCH = 500;

export interface SubRow {
  _id: unknown;
  seller?: unknown;
  planKey?: string;
  status: string;
  currentPeriodEnd?: Date | string | null;
  graceUntil?: Date | string | null;
  trialEndsAt?: Date | string | null;
  cancelAtPeriodEnd?: boolean | null;
  pendingPlanKey?: string | null;
  revision?: number | null;
}

export type TransitionKind = 'trialToExpired' | 'activeToGrace' | 'graceToExpired' | 'cancelledToExpired' | 'downgradeToFree' | 'downgradeToPaid';

export interface Transition {
  kind: TransitionKind;
  from: 'trial' | 'active' | 'grace' | 'cancelled';
  to: 'active' | 'grace' | 'expired';
  set: Record<string, unknown>;
}

const asDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The plan a pending downgrade points at: free (no price) or paid. */
export interface PendingTarget {
  key: string;
  free: boolean;
}

/** Pure: the one move a subscription makes at `now`, or null. `pending` is the target of the row's pendingPlanKey, when it is still a plan one can move to. */
export function planTransition(row: SubRow, now: Date, graceDays: number, pending: PendingTarget | null = null): Transition | null {
  const t = now.getTime();
  const end = asDate(row.currentPeriodEnd);
  switch (row.status) {
    case 'trial': {
      const trialEnds = asDate(row.trialEndsAt);
      return trialEnds !== null && t >= trialEnds.getTime() ? { kind: 'trialToExpired', from: 'trial', to: 'expired', set: { status: 'expired' } } : null;
    }
    case 'active': {
      if (end === null || t < end.getTime()) return null;
      if (row.cancelAtPeriodEnd === true) return { kind: 'cancelledToExpired', from: 'active', to: 'expired', set: { status: 'expired' } };
      if (pending !== null && pending.key !== row.planKey) {
        if (pending.free) {
          return {
            kind: 'downgradeToFree',
            from: 'active',
            to: 'active',
            set: { planKey: pending.key, status: 'active', periodStart: end, currentPeriodEnd: null, graceUntil: null, trialEndsAt: null, cancelAtPeriodEnd: false, pendingPlanKey: null },
          };
        }
        return {
          kind: 'downgradeToPaid',
          from: 'active',
          to: 'grace',
          set: { planKey: pending.key, status: 'grace', graceUntil: new Date(end.getTime() + graceDays * DAY_MS), pendingPlanKey: null },
        };
      }
      return { kind: 'activeToGrace', from: 'active', to: 'grace', set: { status: 'grace', graceUntil: new Date(end.getTime() + graceDays * DAY_MS) } };
    }
    case 'grace': {
      const stored = asDate(row.graceUntil);
      const graceEnd = stored ?? (end === null ? null : new Date(end.getTime() + graceDays * DAY_MS));
      return graceEnd !== null && t >= graceEnd.getTime() ? { kind: 'graceToExpired', from: 'grace', to: 'expired', set: { status: 'expired' } } : null;
    }
    case 'cancelled':
      return end !== null && t >= end.getTime() ? { kind: 'cancelledToExpired', from: 'cancelled', to: 'expired', set: { status: 'expired' } } : null;
    default:
      return null;
  }
}

export interface ExpiryResult {
  dryRun: boolean;
  scanned: number;
  trialToExpired: number;
  activeToGrace: number;
  graceToExpired: number;
  cancelledToExpired: number;
  /** Sprint 6 (S6-B4): downgrades the sellers asked for that took effect at the period end (to Free or to a cheaper paid plan). */
  downgraded: number;
  /** "Ending in 7 days" emails newly queued (a dry run counts the subscriptions that qualify). */
  remindersQueued: number;
  /** "Expired" emails newly queued. */
  expiredNoticesQueued: number;
  skipped: number;
  failed: number;
}

/** What the job sends. Each returns the outbox outcome, or null when nothing could be queued. Replaced in tests. */
export interface ExpiryMail {
  expiring(fields: SubscriptionMailFields): Promise<EnqueueResult | null>;
  expired(fields: SubscriptionMailFields): Promise<EnqueueResult | null>;
}

/** The real senders, only while the database connection is open (a route has connected; a unit test with a stubbed connection has not). */
export const outboxMail: ExpiryMail = {
  expiring: async (fields) => (databaseReady() ? sendSubscriptionExpiring(fields) : null),
  expired: async (fields) => (databaseReady() ? sendSubscriptionExpired(fields) : null),
};

export interface ExpiryOptions {
  /** Apply the moves. Anything but true is a dry run. */
  apply?: boolean;
  now?: Date;
  /** Overrides the platform graceDays (tests). */
  graceDays?: number;
  /** Overrides the email senders (tests). */
  mail?: ExpiryMail;
}

/** The compare-and-set filter: the status and the revision that were read (a row that never had a revision matches 0). */
export function expiryFilter(row: SubRow, from: string): Record<string, unknown> {
  const revision = typeof row.revision === 'number' ? row.revision : 0;
  return { _id: row._id, status: from, revision: revision === 0 ? { $in: [0, null] } : revision };
}

/** Pure: whether the "ending in 7 days" email is due: active, the period ends within REMINDER_DAYS, and the seller is not leaving or moving down. */
export function needsReminder(row: SubRow, now: Date): boolean {
  if (row.status !== 'active' || row.cancelAtPeriodEnd === true || (row.pendingPlanKey ?? null) !== null) return false;
  const end = asDate(row.currentPeriodEnd);
  if (end === null) return false;
  const t = now.getTime();
  return end.getTime() > t && end.getTime() <= t + REMINDER_DAYS * DAY_MS;
}

const mailFieldsOf = (row: SubRow, periodEnd: Date): SubscriptionMailFields => ({
  subscriptionId: String(row._id),
  seller: row.seller === undefined ? '' : String(row.seller),
  planKey: row.planKey ?? '',
  periodEnd,
});

/** The plans the pending downgrades of these rows point at, when they can still be moved to. */
async function pendingTargetsOf(rows: readonly SubRow[]): Promise<Map<string, PendingTarget>> {
  const keys = [...new Set(rows.filter((row) => row.status === 'active' && typeof row.pendingPlanKey === 'string' && row.pendingPlanKey !== '').map((row) => String(row.pendingPlanKey)))];
  const targets = new Map<string, PendingTarget>();
  if (keys.length === 0) return targets;
  const docs = (await SubscriptionPlanModel.find({ key: { $in: keys } } as never)
    .select('key priceRs isActive archivedAt')
    .lean()) as unknown as Array<{ key?: unknown; priceRs?: unknown; isActive?: boolean | null; archivedAt?: unknown }>;
  for (const doc of docs) {
    if (typeof doc.key !== 'string' || doc.isActive === false || doc.archivedAt) continue;
    targets.set(doc.key, { key: doc.key, free: doc.key === 'free' || doc.priceRs === 0 });
  }
  return targets;
}

export async function runSubscriptionExpiry(options: ExpiryOptions = {}): Promise<ExpiryResult> {
  const now = options.now ?? new Date();
  const apply = options.apply === true;
  const mail = options.mail ?? outboxMail;
  const graceDays = options.graceDays ?? (await readPlanSettings()).graceDays ?? DEFAULT_GRACE_DAYS;
  const result: ExpiryResult = {
    dryRun: !apply,
    scanned: 0,
    trialToExpired: 0,
    activeToGrace: 0,
    graceToExpired: 0,
    cancelledToExpired: 0,
    downgraded: 0,
    remindersQueued: 0,
    expiredNoticesQueued: 0,
    skipped: 0,
    failed: 0,
  };
  const counterOf = (kind: TransitionKind): 'trialToExpired' | 'activeToGrace' | 'graceToExpired' | 'cancelledToExpired' | 'downgraded' =>
    kind === 'downgradeToFree' || kind === 'downgradeToPaid' ? 'downgraded' : kind;

  const rows = (await Subscription.find({
    $or: [
      { status: 'trial', trialEndsAt: { $ne: null, $lte: now } },
      { status: { $in: ['active', 'cancelled'] }, currentPeriodEnd: { $ne: null, $lte: now } },
      { status: 'grace' },
    ],
  } as never)
    .sort({ currentPeriodEnd: 1, _id: 1 })
    .limit(EXPIRY_BATCH)
    .lean()) as unknown as SubRow[];
  const targets = await pendingTargetsOf(rows);

  for (const row of rows) {
    result.scanned += 1;
    const pending = typeof row.pendingPlanKey === 'string' ? (targets.get(row.pendingPlanKey) ?? null) : null;
    const move = planTransition(row, now, graceDays, pending);
    if (move === null) continue;
    if (!apply) {
      result[counterOf(move.kind)] += 1;
      continue;
    }
    try {
      const changed = await Subscription.findOneAndUpdate(expiryFilter(row, move.from) as never, { $set: move.set, $inc: { revision: 1 } } as never, { new: true })
        .select('_id')
        .lean();
      if (!changed) {
        result.skipped += 1;
        continue;
      }
      result[counterOf(move.kind)] += 1;
      try {
        await writeAuditLog('subscription.expiry', 'subscription', String(row._id), 'system:expiry', {
          seller: row.seller === undefined ? null : String(row.seller),
          planKey: row.planKey ?? null,
          from: move.from,
          to: move.to,
          ...(counterOf(move.kind) === 'downgraded' ? { newPlanKey: String(move.set.planKey) } : {}),
          at: now.toISOString(),
        });
      } catch (err) {
        console.error('[seller-backend] could not write the subscription expiry audit entry', err instanceof Error ? err.name : 'unknown');
      }
      // The seller is told once (the dedupe key names the subscription and the period). A failed email never undoes the move.
      if (move.to === 'expired') {
        const periodEnd = asDate(row.currentPeriodEnd) ?? asDate(row.trialEndsAt) ?? now;
        await guarded('subscription_expired', async () => {
          if ((await mail.expired(mailFieldsOf(row, periodEnd)))?.outcome === 'queued') result.expiredNoticesQueued += 1;
        });
      }
    } catch (err) {
      result.failed += 1;
      console.error('[seller-backend] could not move a subscription', err instanceof Error ? err.name : 'unknown');
    }
  }

  // The reminders, after the moves: an active subscription whose period ends within 7 days.
  const reminderRows = (await Subscription.find({
    status: 'active',
    cancelAtPeriodEnd: { $ne: true },
    pendingPlanKey: null,
    currentPeriodEnd: { $gt: now, $lte: new Date(now.getTime() + REMINDER_DAYS * DAY_MS) },
  } as never)
    .sort({ currentPeriodEnd: 1, _id: 1 })
    .limit(EXPIRY_BATCH)
    .lean()) as unknown as SubRow[];
  for (const row of reminderRows) {
    if (!needsReminder(row, now)) continue;
    if (!apply) {
      result.remindersQueued += 1;
      continue;
    }
    await guarded('subscription_expiring', async () => {
      if ((await mail.expiring(mailFieldsOf(row, asDate(row.currentPeriodEnd) as Date)))?.outcome === 'queued') result.remindersQueued += 1;
    });
  }
  return result;
}
