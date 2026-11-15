import type {
  CreatePayoutRequest,
  FinishPayoutRequest,
  PayoutBalanceList,
  PayoutBalanceListQuery,
  PayoutBalanceRow,
  PayoutDetailsRequest,
  PayoutFullDetails,
  PayoutList,
  PayoutListQuery,
  PayoutRow,
  VoidPayoutRequest,
} from '@markaz/contracts';
import { requireUserEmailVerified } from '@/lib/account-support';
import { PAYOUT_CODES } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { notifyPayoutPaid, notifyPayoutVoided } from '@/lib/notifications';
import { finishOrRelease, mongoSettlementPort, settlePayout, voidSettled, type SettlementPort } from '@/lib/payout-settlement';
import { CommissionEntry, Payout, Store, User, assertCan, writeAuditLog } from '@/lib/services';
import { readPayout } from '@/lib/store-settings';
import { escapeRegex } from '@/lib/storefront/product-query';

/**
 * Sprint 4 EP-05.US03 (D-088, D-090): what the admin console does with payouts, in the seller backend where the ledger and
 * the payout details live. Every function here is reached through a route signed by the admin backend (MODERATION_API_SECRET,
 * like moderation), so the actor is always an admin and the policy rows are checked as 'admin'.
 *
 * The full payout account number leaves this file in ONE place (readFullPayoutDetails). It is never logged, never in an
 * audit entry, and never in the Payout row (which keeps the last 4 characters only).
 */

/** The seams the tests replace: the settlement port and the clock. */
export const payoutDeps: { port: () => SettlementPort; now: () => Date } = {
  port: () => mongoSettlementPort(),
  now: () => new Date(),
};

const errorName = (err: unknown): string => (err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown');

/** Best effort: the payout is already made or taken back, so a failed entry is logged and never answered. */
async function auditQuietly(action: string, payoutId: string, adminId: string, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'payout', payoutId, 'admin:' + adminId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write a payout audit entry', { action, payoutId, error: errorName(err) });
  }
}

// ----------------------------------------------------------------------------------------------------------- the rows

interface PayoutDoc {
  _id: unknown;
  store: unknown;
  amount: number;
  method: PayoutRow['method'];
  reference: string;
  note?: string | null;
  status: PayoutRow['status'];
  cutoff: Date;
  entryCount: number;
  payoutDetailsSnapshot?: { method: PayoutRow['method']; accountTitle: string; last4: string; bankName?: string | null } | null;
  createdBy: string;
  paidAt?: Date | null;
  failedReason?: string | null;
  voidedAt?: Date | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt: Date;
}

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

export function toPayoutRow(doc: PayoutDoc, storeName: string | null): PayoutRow {
  const snapshot = doc.payoutDetailsSnapshot;
  return {
    id: String(doc._id),
    storeId: String(doc.store),
    storeName,
    amount: doc.amount,
    method: doc.method,
    reference: doc.reference,
    note: doc.note ?? null,
    status: doc.status,
    cutoff: iso(doc.cutoff) ?? '',
    entryCount: doc.entryCount,
    details: {
      method: snapshot?.method ?? doc.method,
      accountTitle: snapshot?.accountTitle ?? '',
      last4: snapshot?.last4 ?? '',
      bankName: snapshot?.bankName ?? null,
    },
    createdBy: doc.createdBy,
    paidAt: iso(doc.paidAt),
    failedReason: doc.failedReason ?? null,
    voidedAt: iso(doc.voidedAt),
    voidedBy: doc.voidedBy ?? null,
    voidReason: doc.voidReason ?? null,
    createdAt: iso(doc.createdAt) ?? '',
  };
}

async function storeNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const stores = (await Store.find({ _id: { $in: unique } }).select('name').lean()) as unknown as Array<{ _id: unknown; name?: string }>;
  return new Map(stores.map((store) => [String(store._id), store.name ?? '']));
}

async function loadRow(payoutId: string): Promise<PayoutRow> {
  const doc = (await Payout.findById(payoutId).lean()) as unknown as PayoutDoc | null;
  if (!doc) throw new HttpError(404, 'Payout not found');
  return toPayoutRow(doc, (await storeNames([String(doc.store)])).get(String(doc.store)) ?? null);
}

// ------------------------------------------------------------------------------------------------------------- lists

interface BalanceGroup {
  _id: unknown;
  balance: number;
  entries: number;
}

/**
 * The balance of every store with unsettled entries: the sum of their balanceEffect (signed whole rupees), the count, and
 * what the admin needs to know before paying (payout method and last 4, whether details exist, whether the owner's email is
 * verified, whether a payout is stuck). A zero or negative balance is listed too: it cannot be paid and carries forward.
 */
export async function listBalances(query: PayoutBalanceListQuery): Promise<PayoutBalanceList> {
  assertCan('admin', 'read', 'payouts');
  const match: Record<string, unknown> = { settledAt: null };
  if (query.q) {
    const found = (await Store.find({ name: { $regex: escapeRegex(query.q), $options: 'i' } })
      .select('_id')
      .limit(500)
      .lean()) as unknown as Array<{ _id: unknown }>;
    match.store = { $in: found.map((store) => store._id) };
  }
  const facets = (await CommissionEntry.aggregate([
    { $match: match },
    { $group: { _id: '$store', balance: { $sum: '$balanceEffect' }, entries: { $sum: 1 } } },
    { $sort: { balance: -1, _id: 1 } },
    { $facet: { rows: [{ $skip: (query.page - 1) * query.limit }, { $limit: query.limit }], total: [{ $count: 'n' }] } },
  ])) as unknown as Array<{ rows?: BalanceGroup[]; total?: Array<{ n?: number }> }>;
  const rows = facets[0]?.rows ?? [];
  const totalDocs = facets[0]?.total?.[0]?.n ?? 0;

  const ids = rows.map((row) => String(row._id));
  const stores =
    ids.length === 0
      ? []
      : ((await Store.find({ _id: { $in: ids } }).select('name owner +payoutDetails').lean()) as unknown as Array<{
          _id: unknown;
          name?: string;
          owner?: unknown;
          payoutDetails?: unknown;
        }>);
  const owners = [...new Set(stores.map((store) => (store.owner ? String(store.owner) : '')).filter((id) => id !== ''))];
  const [users, pending] = await Promise.all([
    owners.length === 0 ? [] : ((await User.find({ _id: { $in: owners } }).select('emailVerifiedAt').lean()) as unknown as Array<{ _id: unknown; emailVerifiedAt?: unknown }>),
    ids.length === 0 ? [] : ((await Payout.find({ store: { $in: ids }, status: 'pending_settle' }).select('store').lean()) as unknown as Array<{ store: unknown }>),
  ]);
  const verified = new Set(users.filter((user) => Boolean(user.emailVerifiedAt)).map((user) => String(user._id)));
  const stuck = new Set(pending.map((row) => String(row.store)));
  const byId = new Map(stores.map((store) => [String(store._id), store]));

  const docs: PayoutBalanceRow[] = rows.map((row) => {
    const store = byId.get(String(row._id));
    const details = readPayout(store?.payoutDetails);
    return {
      storeId: String(row._id),
      storeName: store?.name ?? '(unknown store)',
      balance: row.balance === 0 ? 0 : row.balance,
      unsettledEntries: row.entries,
      payoutMethod: details?.method ?? null,
      payoutLast4: details ? details.accountNumber.slice(-4) : null,
      hasPayoutDetails: details !== null,
      emailVerified: store?.owner ? verified.has(String(store.owner)) : false,
      hasPendingPayout: stuck.has(String(row._id)),
    };
  });
  return { docs, page: query.page, limit: query.limit, totalDocs, totalPages: Math.ceil(totalDocs / query.limit) };
}

/** The payout history across stores, newest first. A payout stuck in pending_settle is in it: that is how it is found. */
export async function listPayouts(query: PayoutListQuery): Promise<PayoutList> {
  assertCan('admin', 'read', 'payouts');
  const filter: Record<string, unknown> = { ...(query.storeId ? { store: oid(query.storeId) } : {}), ...(query.status ? { status: query.status } : {}) };
  const [rows, totalDocs] = await Promise.all([
    Payout.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<PayoutDoc[]>,
    Payout.countDocuments(filter),
  ]);
  const names = await storeNames(rows.map((row) => String(row.store)));
  return {
    docs: rows.map((row) => toPayoutRow(row, names.get(String(row.store)) ?? null)),
    page: query.page,
    limit: query.limit,
    totalDocs,
    totalPages: Math.ceil(totalDocs / query.limit),
  };
}

// ----------------------------------------------------------------------------------------------------------- create

interface StoreForPayout {
  _id: unknown;
  name?: string;
  owner?: unknown;
  payoutDetails?: unknown;
}

async function loadStoreForPayout(storeId: string): Promise<StoreForPayout> {
  const store = (await Store.findById(storeId).select('name owner +payoutDetails').lean()) as unknown as StoreForPayout | null;
  if (!store) throw new HttpError(404, 'Store not found');
  return store;
}

/**
 * Pays a store its whole balance (B3). Checks, in order: the store exists, it has payout details, its owner's email is
 * verified, then the settlement itself (balance above zero, expectedBalance equal to it, the claim). Answers the paid
 * payout. The seller's email is queued after the response.
 */
export async function createPayout(input: CreatePayoutRequest, adminId: string): Promise<PayoutRow> {
  assertCan('admin', 'create', 'payouts');
  const store = await loadStoreForPayout(input.storeId);
  const details = readPayout(store.payoutDetails);
  if (details === null) {
    throw new HttpError(409, 'This store has not saved payout details yet, so there is nowhere to send the money.', PAYOUT_CODES.NO_PAYOUT_DETAILS);
  }
  if (input.method !== details.method) {
    throw new HttpError(422, 'A payout is paid only by the method the seller saved (' + details.method + ').', PAYOUT_CODES.METHOD_MISMATCH);
  }
  await requireUserEmailVerified(store.owner ? String(store.owner) : '');

  const payoutId = await settlePayout(payoutDeps.port(), {
    store: input.storeId,
    expectedBalance: input.expectedBalance,
    method: input.method,
    reference: input.reference,
    note: input.note ?? null,
    payoutDetailsSnapshot: { method: details.method, accountTitle: details.accountTitle, last4: details.accountNumber.slice(-4), bankName: details.bankName },
    createdBy: adminId,
    now: payoutDeps.now(),
  });

  const row = await loadRow(payoutId);
  await auditQuietly('payout.create', payoutId, adminId, { storeId: input.storeId, amount: row.amount, method: row.method, entryCount: row.entryCount });
  notifyPayoutPaid(input.storeId, { id: payoutId, amount: row.amount, method: row.method, reference: row.reference });
  return row;
}

// ------------------------------------------------------------------------------------------------- void and finish

/** Takes a paid payout back (B4). The entries are open again and count in the balance. Idempotent. */
export async function voidPayout(input: VoidPayoutRequest, adminId: string): Promise<PayoutRow> {
  assertCan('admin', 'update', 'payouts');
  const outcome = await voidSettled(payoutDeps.port(), input.payoutId, adminId, input.reason, payoutDeps.now());
  const row = await loadRow(input.payoutId);
  if (outcome.changed) {
    await auditQuietly('payout.void', input.payoutId, adminId, { storeId: row.storeId, amount: row.amount, reason: input.reason });
    notifyPayoutVoided(row.storeId, { id: input.payoutId, amount: row.amount, method: row.method, reference: row.reference, voidReason: input.reason });
  }
  return row;
}

/** The "finish or release" step for a payout stuck in pending_settle. Idempotent; a payout in any other state is answered as it is. */
export async function finishPayout(input: FinishPayoutRequest, adminId: string): Promise<PayoutRow> {
  assertCan('admin', 'update', 'payouts');
  const outcome = await finishOrRelease(payoutDeps.port(), input.payoutId, payoutDeps.now());
  const row = await loadRow(input.payoutId);
  if (outcome.changed) {
    await auditQuietly('payout.finish', input.payoutId, adminId, { storeId: row.storeId, amount: row.amount, result: outcome.status });
    if (outcome.status === 'paid') notifyPayoutPaid(row.storeId, { id: input.payoutId, amount: row.amount, method: row.method, reference: row.reference });
  }
  return row;
}

// ------------------------------------------------------------------------------------------------------ full details

/**
 * The full payout account of one store, for the admin who has to send the money (B5). The audit entry is written BEFORE the
 * number leaves: if it cannot be written the call fails and nothing is shown. The entry names the admin and the store and
 * never the number; this function never logs it.
 */
export async function readFullPayoutDetails(input: PayoutDetailsRequest, adminId: string): Promise<PayoutFullDetails> {
  assertCan('admin', 'read', 'payoutDetails');
  const store = await loadStoreForPayout(input.storeId);
  const details = readPayout(store.payoutDetails);
  if (details === null) throw new HttpError(404, 'This store has no payout details.', PAYOUT_CODES.NO_PAYOUT_DETAILS);

  try {
    await writeAuditLog('payout_details_viewed', 'store', input.storeId, 'admin:' + adminId, { storeId: input.storeId, adminId, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the payout details audit entry', { storeId: input.storeId, error: errorName(err) });
    throw new HttpError(503, 'The view could not be recorded, so the account details are not shown. Try again.');
  }
  return { storeId: input.storeId, method: details.method, accountTitle: details.accountTitle, accountNumber: details.accountNumber, bankName: details.bankName };
}
