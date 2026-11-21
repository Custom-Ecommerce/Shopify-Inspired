import { readPlanSettings, DEFAULT_GRACE_DAYS } from '@/lib/platform-settings';
import { Subscription, writeAuditLog } from '@/lib/services';

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
 * One step per run: a subscription the job missed for weeks reaches `expired` over two runs, never in a way that skips the audit trail of the
 * step. Each move is a compare-and-set on the status and the revision that were read, so two runs (or an admin editing at the same moment) cannot
 * both win: the loser counts as skipped. A run is a DRY RUN unless it is told to apply; it writes nothing then. Every applied move leaves one audit
 * line. Nothing is ever deleted: expired means the Free limits, not a removed subscription.
 */

const DAY_MS = 86_400_000;
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
  revision?: number | null;
}

export type TransitionKind = 'trialToExpired' | 'activeToGrace' | 'graceToExpired' | 'cancelledToExpired';

export interface Transition {
  kind: TransitionKind;
  from: 'trial' | 'active' | 'grace' | 'cancelled';
  to: 'grace' | 'expired';
  set: Record<string, unknown>;
}

const asDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Pure: the one move a subscription makes at `now`, or null. */
export function planTransition(row: SubRow, now: Date, graceDays: number): Transition | null {
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
  skipped: number;
  failed: number;
}

export interface ExpiryOptions {
  /** Apply the moves. Anything but true is a dry run. */
  apply?: boolean;
  now?: Date;
  /** Overrides the platform graceDays (tests). */
  graceDays?: number;
}

/** The compare-and-set filter: the status and the revision that were read (a row that never had a revision matches 0). */
export function expiryFilter(row: SubRow, from: string): Record<string, unknown> {
  const revision = typeof row.revision === 'number' ? row.revision : 0;
  return { _id: row._id, status: from, revision: revision === 0 ? { $in: [0, null] } : revision };
}

export async function runSubscriptionExpiry(options: ExpiryOptions = {}): Promise<ExpiryResult> {
  const now = options.now ?? new Date();
  const apply = options.apply === true;
  const graceDays = options.graceDays ?? (await readPlanSettings()).graceDays ?? DEFAULT_GRACE_DAYS;
  const result: ExpiryResult = { dryRun: !apply, scanned: 0, trialToExpired: 0, activeToGrace: 0, graceToExpired: 0, cancelledToExpired: 0, skipped: 0, failed: 0 };

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

  for (const row of rows) {
    result.scanned += 1;
    const move = planTransition(row, now, graceDays);
    if (move === null) continue;
    if (!apply) {
      result[move.kind] += 1;
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
      result[move.kind] += 1;
      try {
        await writeAuditLog('subscription.expiry', 'subscription', String(row._id), 'system:expiry', {
          seller: row.seller === undefined ? null : String(row.seller),
          planKey: row.planKey ?? null,
          from: move.from,
          to: move.to,
          at: now.toISOString(),
        });
      } catch (err) {
        console.error('[seller-backend] could not write the subscription expiry audit entry', err instanceof Error ? err.name : 'unknown');
      }
    } catch (err) {
      result.failed += 1;
      console.error('[seller-backend] could not move a subscription', err instanceof Error ? err.name : 'unknown');
    }
  }
  return result;
}
