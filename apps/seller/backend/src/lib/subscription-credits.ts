import { FREE_PLAN_KEY } from '@/lib/plan';
import { SubscriptionCredit, Subscription, writeAuditLog } from '@/lib/services';
import { addMonthsUtc } from '@/lib/subscription-period';
import { revisionFilter, type SubscriptionRow } from '@/lib/subscription-payments';

/*
 * Sprint 8 (S8-B6, D-118): free months (SubscriptionCredit). A credit never grants a plan: it lengthens a PAID period. It is claimed row by row with a
 * compare-and-set on usedAt null, so one month is never given twice, and released again when what claimed it did not happen.
 *
 * Whole calendar months in UTC, the day clamped to the target month (31 January + 1 month is the last day of February).
 */

type Row = Record<string, any>;

export interface ClaimedCredits {
  ids: string[];
  months: number;
}

export const NO_CREDITS: ClaimedCredits = Object.freeze({ ids: [] as string[], months: 0 });

/** Takes every waiting credit of a seller. paymentId names the payment that uses them, or null for a running period. */
export async function claimCredits(sellerId: string, paymentId: unknown, now: Date): Promise<ClaimedCredits> {
  const waiting = (await SubscriptionCredit.find({ seller: sellerId, usedAt: null } as never).lean()) as unknown as Row[];
  const ids: string[] = [];
  let months = 0;
  for (const credit of waiting) {
    const taken = (await SubscriptionCredit.findOneAndUpdate(
      { _id: credit._id, usedAt: null } as never,
      { $set: { usedAt: now, usedByPayment: paymentId } } as never,
      { new: true },
    ).lean()) as unknown as Row | null;
    if (!taken) continue;
    ids.push(String(taken._id));
    months += typeof taken.months === 'number' ? taken.months : 0;
  }
  return { ids, months };
}

/** Puts claimed credits back to waiting. Best effort: a failure is logged. */
export async function releaseCredits(filter: { ids: string[] } | { paymentId: unknown }): Promise<void> {
  if ('ids' in filter && filter.ids.length === 0) return;
  try {
    await SubscriptionCredit.updateMany(
      ('ids' in filter ? { _id: { $in: filter.ids } } : { usedByPayment: filter.paymentId }) as never,
      { $set: { usedAt: null, usedByPayment: null } } as never,
    );
  } catch (err) {
    console.error('[seller-backend] could not release subscription credits', err instanceof Error ? err.name : 'unknown');
  }
}

/** A paid period that is still running: not Free, active (or cancelled with the period not over), with an end in the future. A trial or grace is not one. */
export function isRunningPaidPeriod(sub: Row | null | undefined, now: Date): boolean {
  if (!sub || sub.planKey === FREE_PLAN_KEY || (sub.status !== 'active' && sub.status !== 'cancelled') || !sub.currentPeriodEnd) return false;
  return new Date(sub.currentPeriodEnd as Date).getTime() > now.getTime();
}

export interface Extension {
  planKey: string;
  months: number;
  periodEnd: Date;
}

/**
 * Adds the seller's waiting months to a running paid period, with ONE compare-and-set on the subscription's revision. Null when there is no running paid period,
 * no waiting credit, or the subscription changed in the same instant (the credits then stay waiting for the next confirmed payment). The plan is not changed.
 */
export async function extendRunningSubscription(sellerId: string, now: Date, actorId: string): Promise<Extension | null> {
  const sub = (await Subscription.findOne({ seller: sellerId } as never).lean()) as unknown as SubscriptionRow | null;
  if (!isRunningPaidPeriod(sub as unknown as Row | null, now)) return null;
  const row = sub as unknown as Row;
  const credits = await claimCredits(sellerId, null, now);
  if (credits.months === 0) return null;
  const from = new Date(row.currentPeriodEnd);
  const periodEnd = addMonthsUtc(from, credits.months);
  try {
    const moved = await Subscription.findOneAndUpdate(
      { _id: row._id, revision: revisionFilter(row.revision) } as never,
      { $set: { currentPeriodEnd: periodEnd, graceUntil: null }, $inc: { revision: 1 } } as never,
      { new: true },
    )
      .select('_id')
      .lean();
    if (!moved) {
      await releaseCredits({ ids: credits.ids });
      return null;
    }
  } catch (err) {
    await releaseCredits({ ids: credits.ids });
    throw err;
  }
  try {
    await writeAuditLog('subscription.referral_extended', 'subscription', String(row._id), actorId, {
      seller: sellerId,
      planKey: row.planKey,
      months: credits.months,
      from: from.toISOString(),
      to: periodEnd.toISOString(),
      credits: credits.ids,
      at: now.toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the subscription extension audit entry', err instanceof Error ? err.name : 'unknown');
  }
  return { planKey: String(row.planKey), months: credits.months, periodEnd };
}
