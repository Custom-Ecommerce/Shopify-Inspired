import mongoose from 'mongoose';
import { PAYOUT_CODES } from '@/lib/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { CommissionEntry, Payout } from '@/lib/services';

/**
 * Sprint 4 EP-05.US03 (D-090): the settlement of a payout against the commission ledger, as a small saga over a port.
 *
 *   1  insert the Payout as pending_settle. The partial unique index {store} where pending_settle lets only one in at a time,
 *      so two admins paying one store at once leave one payout and a 409 for the other.
 *   2  claim: ONE updateMany sets settledAt and payoutId on the store's unsettled entries created up to the cutoff. An entry
 *      that already has a payoutId is never matched, so no entry is ever settled twice.
 *   3  verify the claimed sum and count are what the admin was shown. If not, release exactly the entries this payout
 *      claimed (settledAt and payoutId back to null), mark the payout failed and answer 409.
 *   4  mark the payout paid (compare-and-set from pending_settle).
 *
 * A request can die between the steps. A payout left in pending_settle is shown in the admin list, and finishOrRelease()
 * (called by the retry button and by void) settles it the same way again: it is idempotent, and it never leaves an entry
 * claimed by a payout that failed.
 */

export type PayoutState = 'pending_settle' | 'paid' | 'voided' | 'failed';

export interface PayoutRecord {
  id: string;
  store: string;
  amount: number;
  status: PayoutState;
  cutoff: Date;
  entryCount: number;
}

export interface NewPendingPayout {
  store: string;
  amount: number;
  method: 'bank' | 'jazzcash' | 'easypaisa';
  reference: string;
  note: string | null;
  cutoff: Date;
  entryCount: number;
  payoutDetailsSnapshot: { method: 'bank' | 'jazzcash' | 'easypaisa'; accountTitle: string; last4: string; bankName: string | null };
  createdBy: string;
}

export interface Totals {
  sum: number;
  count: number;
}

/** The only operations the saga needs. The Mongo implementation is below; the tests bring an in-memory one. */
export interface SettlementPort {
  /** Inserts the pending_settle row. Throws a duplicate-key error (code 11000) while the store has another one pending. */
  insertPending(doc: NewPendingPayout): Promise<string>;
  /** Sum and count of the store's unsettled entries created at or before the cutoff. */
  unsettledUpTo(store: string, cutoff: Date): Promise<Totals>;
  /** Claims the store's unclaimed, unsettled entries created at or before the cutoff for the payout. Answers how many. */
  claim(store: string, cutoff: Date, payoutId: string, at: Date): Promise<number>;
  /** Sum and count of the entries this payout holds. */
  claimed(payoutId: string): Promise<Totals>;
  /** Releases exactly the entries this payout holds. Answers how many. */
  release(payoutId: string): Promise<number>;
  /** Compare-and-set of the payout status. True when this call moved it. */
  transition(payoutId: string, from: readonly PayoutState[], to: PayoutState, set: Record<string, unknown>): Promise<boolean>;
  load(payoutId: string): Promise<PayoutRecord | null>;
}

const reload = (): HttpError => new HttpError(409, 'The balance changed while you were paying. Reload and try again.', PAYOUT_CODES.BALANCE_CHANGED);

export interface SettleInput extends Omit<NewPendingPayout, 'cutoff' | 'entryCount' | 'amount'> {
  /** The balance the admin saw. */
  expectedBalance: number;
  now: Date;
}

/** Steps 1 to 4. Answers the paid payout's id. Throws HttpError 409 with a PAYOUT_CODES code when it cannot be made. */
export async function settlePayout(port: SettlementPort, input: SettleInput): Promise<string> {
  const cutoff = input.now;
  const before = await port.unsettledUpTo(input.store, cutoff);
  if (before.sum <= 0) {
    throw new HttpError(409, 'This store has nothing to be paid: its balance is zero or negative and carries forward.', PAYOUT_CODES.NOTHING_TO_PAY);
  }
  if (before.sum !== input.expectedBalance) throw reload();

  const { expectedBalance, now, ...rest } = input;
  void now;
  let payoutId: string;
  try {
    payoutId = await port.insertPending({ ...rest, amount: expectedBalance, cutoff, entryCount: before.count });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new HttpError(409, 'Another payout of this store is being made. Check the payout history first.', PAYOUT_CODES.IN_PROGRESS);
    }
    throw err;
  }

  const outcome = await finishOrRelease(port, payoutId, input.now);
  if (outcome.status !== 'paid') throw reload();
  return payoutId;
}

export interface FinishOutcome {
  status: PayoutState;
  /** True when this call moved the payout (to paid or to failed). */
  changed: boolean;
}

/**
 * Settles a pending_settle payout one way or the other, and is safe to run again and again:
 *   - the claim is repeated (it picks up what a dead request did not reach, and never touches a claimed entry),
 *   - when the entries it holds are exactly what the payout says (sum and count), it becomes paid,
 *   - otherwise exactly the entries it holds are released and it becomes failed.
 * A payout that is not pending_settle is answered as it is.
 */
export async function finishOrRelease(port: SettlementPort, payoutId: string, now: Date): Promise<FinishOutcome> {
  const payout = await port.load(payoutId);
  if (!payout) throw new HttpError(404, 'Payout not found');
  if (payout.status !== 'pending_settle') return { status: payout.status, changed: false };

  await port.claim(payout.store, payout.cutoff, payoutId, now);
  const held = await port.claimed(payoutId);
  if (held.sum === payout.amount && held.count === payout.entryCount) {
    const moved = await port.transition(payoutId, ['pending_settle'], 'paid', { paidAt: now });
    if (moved) return { status: 'paid', changed: true };
    // Someone else resolved it first: report what it is now.
    const current = await port.load(payoutId);
    return { status: current?.status ?? 'failed', changed: false };
  }

  // Never leave an entry claimed by a payout that is not paid: release first, then mark it failed.
  await port.release(payoutId);
  const moved = await port.transition(payoutId, ['pending_settle'], 'failed', {
    failedReason: 'The ledger changed while the payout was being settled; its entries were released.',
  });
  if (moved) return { status: 'failed', changed: true };
  const current = await port.load(payoutId);
  return { status: current?.status ?? 'failed', changed: false };
}

export interface VoidOutcome {
  /** True when this call moved paid to voided. A repeat answers false and only makes sure the entries are free. */
  changed: boolean;
}

/**
 * Takes a paid payout back: compare-and-set paid to voided, then release its entries. A repeat finds it voided and runs the
 * release again, which is harmless. A payout still pending_settle is first finished or released, so a stuck one can be voided
 * once it became paid. A failed payout has nothing to take back.
 */
export async function voidSettled(port: SettlementPort, payoutId: string, admin: string, reason: string, now: Date): Promise<VoidOutcome> {
  let payout = await port.load(payoutId);
  if (!payout) throw new HttpError(404, 'Payout not found');
  if (payout.status === 'pending_settle') {
    await finishOrRelease(port, payoutId, now);
    payout = await port.load(payoutId);
    if (!payout) throw new HttpError(404, 'Payout not found');
  }
  if (payout.status === 'failed') {
    throw new HttpError(409, 'This payout failed and its entries were already released. There is nothing to void.', PAYOUT_CODES.WRONG_STATE);
  }

  let changed = false;
  if (payout.status === 'paid') {
    changed = await port.transition(payoutId, ['paid'], 'voided', { voidedAt: now, voidedBy: admin, voidReason: reason });
  }
  // Voided by this call, by a parallel one, or by an earlier call that died before the release: free its entries again.
  await port.release(payoutId);
  return { changed };
}

// ---------------------------------------------------------------------------------------------------------------------
// The MongoDB port

const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);

async function totals(match: Record<string, unknown>): Promise<Totals> {
  const rows = (await CommissionEntry.aggregate([
    { $match: match },
    { $group: { _id: null, sum: { $sum: '$balanceEffect' }, count: { $sum: 1 } } },
  ])) as Array<{ sum?: number; count?: number }>;
  return { sum: rows[0]?.sum ?? 0, count: rows[0]?.count ?? 0 };
}

export function mongoSettlementPort(): SettlementPort {
  return {
    async insertPending(doc) {
      const created = (await Payout.create({ ...doc, status: 'pending_settle' })) as unknown as { _id: unknown };
      return String(created._id);
    },
    unsettledUpTo: (store, cutoff) => totals({ store: oid(store), settledAt: null, payoutId: null, createdAt: { $lte: cutoff } }),
    async claim(store, cutoff, payoutId, at) {
      const result = await CommissionEntry.updateMany(
        { store: oid(store), settledAt: null, payoutId: null, createdAt: { $lte: cutoff } },
        { $set: { settledAt: at, payoutId: oid(payoutId) } },
      );
      return result.modifiedCount;
    },
    claimed: (payoutId) => totals({ payoutId: oid(payoutId) }),
    async release(payoutId) {
      const result = await CommissionEntry.updateMany({ payoutId: oid(payoutId) }, { $set: { settledAt: null, payoutId: null } });
      return result.modifiedCount;
    },
    async transition(payoutId, from, to, set) {
      const updated = await Payout.findOneAndUpdate({ _id: payoutId, status: { $in: [...from] } }, { $set: { status: to, ...set } }, { new: true })
        .select('_id')
        .lean();
      return updated !== null;
    },
    async load(payoutId) {
      if (!mongoose.isValidObjectId(payoutId)) return null;
      const row = (await Payout.findById(payoutId).select('store amount status cutoff entryCount').lean()) as unknown as {
        _id: unknown;
        store: unknown;
        amount: number;
        status: PayoutState;
        cutoff: Date;
        entryCount: number;
      } | null;
      return row === null ? null : { id: String(row._id), store: String(row.store), amount: row.amount, status: row.status, cutoff: row.cutoff, entryCount: row.entryCount };
    },
  };
}
