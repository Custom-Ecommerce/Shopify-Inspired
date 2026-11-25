import { commissionReversal } from '@/lib/contracts';
import { databaseReady } from '@/lib/notifications';
import { readPlatformSettings } from '@/lib/platform-settings';
import { CommissionEntry, Store, writeAuditLog } from '@/lib/services';

/**
 * Sprint 4 EP-05 (D-088, D-089, D-090): the commission ledger of storefront orders, in WHOLE RUPEES, in the new
 * CommissionEntry collection (never the old commissionLedger).
 *
 *   COD   one cod_commission (-commission) when the order is BOTH delivered AND collected, at whichever comes last.
 *   Card  card_sale (+total paid) and card_commission (-commission) when the unpaid-to-paid compare-and-set is won.
 *   Undo  reverseLedgerForOrder writes one mirror entry per original, once.
 *
 * The commission is taken on the item subtotal AFTER discount (delivery excluded), read from the order's own stored
 * subtotal and discountAmount. Every write is best effort: it logs without secrets, never throws and never blocks the
 * transition that caused it. The unique index { order, type, reversesType } makes a repeat or a parallel write a no-op, so
 * a duplicate key counts as success. A backfilled entry uses the rate that applies NOW.
 *
 * Sprint 6 D-116: cash on delivery has its OWN percent, the platform setting codCommissionPercent (default 0). A store's custom rate and
 * the platform default rate belong to GATEWAY (card) orders only. At 0 percent a COD order STILL writes its cod_commission entry, with rate 0
 * and balanceEffect 0: earnings, the admin report and the backfill all count entries. An entry already written is never rewritten when the
 * percent changes (the unique index makes the repeat a no-op), so a change applies to orders collected after it, never retroactively.
 */

export const COMMISSION_RATE_MAX = 100;

/** A percentage with one decimal. */
export function roundRate(value: number): number {
  return Math.round(value * 10) / 10;
}

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= COMMISSION_RATE_MAX;
}

export interface StoreRateFields {
  commissionMode?: unknown;
  commissionRate?: unknown;
}

export type RateSource = 'custom' | 'default';

/**
 * The GATEWAY (card) rate: the store's custom rate when it has one (mode custom and a valid rate), else the platform default;
 * one decimal. Cash on delivery does not use it (codCommissionRate).
 */
export async function commissionRateAndSource(store: StoreRateFields | null): Promise<{ rate: number; source: RateSource }> {
  if (store && store.commissionMode === 'custom' && validRate(store.commissionRate)) {
    return { rate: roundRate(store.commissionRate), source: 'custom' };
  }
  const settings = await readPlatformSettings();
  return { rate: roundRate(settings.defaultCommissionRate), source: 'default' };
}

export async function commissionRateFor(store: StoreRateFields | null): Promise<number> {
  return (await commissionRateAndSource(store)).rate;
}

/**
 * Sprint 6 D-116: the commission percent on cash-on-delivery orders: the platform setting codCommissionPercent (document, then the
 * COD_COMMISSION_PERCENT environment variable, then 0), one decimal. A store's custom rate does NOT apply here.
 */
export async function codCommissionRate(): Promise<number> {
  return roundRate((await readPlatformSettings()).codCommissionPercent);
}

/**
 * The commission in whole rupees: the item subtotal after discount times the rate, rounded to the nearest rupee, never
 * negative. Integer arithmetic on tenths of a percent, so a half rupee rounds the same way every time.
 */
export function commissionFor(itemSubtotalAfterDiscount: number, rate: number): number {
  if (!Number.isFinite(itemSubtotalAfterDiscount) || !Number.isFinite(rate)) return 0;
  const base = Math.max(0, Math.round(itemSubtotalAfterDiscount));
  const tenths = Math.max(0, Math.round(rate * 10));
  return Math.max(0, Math.round((base * tenths) / 1000));
}

/** The fields of an order the ledger reads. */
export interface LedgerOrder {
  _id: unknown;
  store: unknown;
  orderId?: string;
  paymentMethod?: unknown;
  status?: unknown;
  paymentStatus?: unknown;
  subtotal?: unknown;
  discountAmount?: unknown;
  total?: unknown;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The item subtotal after discount, which the order already stores as subtotal and discountAmount. */
export function commissionBase(order: LedgerOrder): number {
  return Math.max(0, Math.round(num(order.subtotal) - num(order.discountAmount)));
}

/**
 * A ledger write only runs on an open database connection. A route has always connected first; the unit tests of other
 * routes stub the connection, and without this guard a write would wait on a buffered Mongoose command.
 */
const ledgerReady = (): boolean => databaseReady();

const isDuplicateKey = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
/** The error's class name only: a driver message can carry the connection string, so it is never logged. */
const errorName = (err: unknown): string => (err instanceof Error ? err.name : 'unknown');

interface NewEntry {
  store: unknown;
  order: unknown;
  type: 'cod_commission' | 'card_sale' | 'card_commission' | 'reversal';
  balanceEffect: number;
  baseAmount: number;
  rate: number;
  reversesType?: 'cod_commission' | 'card_sale' | 'card_commission' | null;
  /** Sprint 5 EP-13: set only on the reversal of one return. */
  returnId?: unknown;
}

/** Writes one entry. 'exists' when the unique index says it is already there. Throws on any other failure. */
async function writeEntry(entry: NewEntry): Promise<'created' | 'exists'> {
  try {
    await CommissionEntry.create({
      ...entry,
      balanceEffect: entry.balanceEffect === 0 ? 0 : entry.balanceEffect,
      reversesType: entry.reversesType ?? null,
      returnId: entry.returnId ?? null,
      settledAt: null,
      payoutId: null,
    });
    return 'created';
  } catch (err) {
    if (isDuplicateKey(err)) return 'exists';
    throw err;
  }
}

async function storeRateFields(storeId: unknown): Promise<StoreRateFields | null> {
  return (await Store.findById(String(storeId)).select('commissionMode commissionRate').lean()) as StoreRateFields | null;
}

/** True when this order is cash on delivery, delivered and collected: the moment its commission is owed. */
export function codCommissionDue(order: LedgerOrder): boolean {
  return order.paymentMethod === 'cod' && order.status === 'delivered' && order.paymentStatus === 'collected';
}

/**
 * Writes the order's cod_commission when it is due. Safe to call from both events (delivered, collected): only the call that
 * sees both states writes, and a second one finds the entry. Never throws. The rate is the platform COD percent (0 by default, D-116);
 * at 0 the entry is still written (rate 0, balanceEffect 0).
 */
export async function recordCodCommission(order: LedgerOrder): Promise<'created' | 'exists' | 'not_due' | 'failed'> {
  if (!codCommissionDue(order)) return 'not_due';
  if (!ledgerReady()) return 'failed';
  try {
    const rate = await codCommissionRate();
    const base = commissionBase(order);
    const result = await writeEntry({ store: order.store, order: order._id, type: 'cod_commission', balanceEffect: -commissionFor(base, rate), baseAmount: base, rate });
    return result;
  } catch (err) {
    console.error('[seller-backend] could not write the COD commission entry', { orderId: String(order._id), error: errorName(err) });
    return 'failed';
  }
}

/** The card sale and its commission, once the order is paid, at the GATEWAY rate (store custom rate, else the default). Each entry is idempotent on its own. Never throws. */
export async function recordCardEntries(order: LedgerOrder): Promise<'ok' | 'not_due' | 'failed'> {
  if (order.paymentMethod !== 'card' || order.paymentStatus !== 'paid') return 'not_due';
  if (!ledgerReady()) return 'failed';
  try {
    const { rate } = await commissionRateAndSource(await storeRateFields(order.store));
    const base = commissionBase(order);
    const total = Math.max(0, Math.round(num(order.total)));
    await writeEntry({ store: order.store, order: order._id, type: 'card_sale', balanceEffect: total, baseAmount: total, rate });
    await writeEntry({ store: order.store, order: order._id, type: 'card_commission', balanceEffect: -commissionFor(base, rate), baseAmount: base, rate });
    return 'ok';
  } catch (err) {
    console.error('[seller-backend] could not write the card ledger entries', { orderId: String(order._id), error: errorName(err) });
    return 'failed';
  }
}

interface StoredEntry {
  store: unknown;
  order: unknown;
  type: string;
  balanceEffect: number;
  baseAmount: number;
  rate: number;
}

/**
 * For each original entry of the order (not a reversal), writes one reversal: balanceEffect is the opposite sign and
 * reversesType the original's type, once only. The original's settled or unsettled state is left as it is (SB-7 nets a
 * reversal of a settled entry into the next payout). Returns how many reversals were written. Never throws.
 */
export async function reverseLedgerForOrder(orderId: string, reason: string): Promise<{ written: number; existing: number; failed: number }> {
  const result = { written: 0, existing: 0, failed: 0 };
  if (!ledgerReady()) return result;
  try {
    const originals = (await CommissionEntry.find({ order: orderId, type: { $ne: 'reversal' } }).lean()) as unknown as StoredEntry[];
    for (const original of originals) {
      try {
        const outcome = await writeEntry({
          store: original.store,
          order: original.order,
          type: 'reversal',
          balanceEffect: -original.balanceEffect,
          baseAmount: original.baseAmount,
          rate: original.rate,
          reversesType: original.type as 'cod_commission' | 'card_sale' | 'card_commission',
        });
        if (outcome === 'created') result.written += 1;
        else result.existing += 1;
      } catch (err) {
        result.failed += 1;
        console.error('[seller-backend] could not write a commission reversal', { orderId, type: original.type, error: errorName(err) });
      }
    }
    if (result.written > 0) {
      try {
        await writeAuditLog('commission.reversal', 'order', orderId, 'system:commission', { reason: reason.slice(0, 300), written: result.written, at: new Date().toISOString() });
      } catch (err) {
        console.error('[seller-backend] could not write the commission reversal audit entry', { orderId, error: errorName(err) });
      }
    }
  } catch (err) {
    result.failed += 1;
    console.error('[seller-backend] could not read the commission entries of an order', { orderId, error: errorName(err) });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 5 EP-13.US03.T03 (D-107, audit R2): the proportional reversal of a return

export interface ReturnReversalInput {
  /** The return this reversal belongs to. One reversal per return, whatever the number of refunds recorded for it. */
  returnId: unknown;
  order: LedgerOrder;
  /** The returned base of THIS return: the price of the returned quantities less their discount share, delivery excluded. */
  returnedBase: number;
  /** SB-6: true when this return completes the received quantities of the whole order (completionOf): it takes everything that is left of the commission. */
  completesOrder?: boolean;
  /** SB-7: the earlier received returns of the order and their proportional caps (from completionOf), used only with completesOrder. */
  earlierReturns?: ReadonlyArray<{ returnId: unknown; base: number }>;
}

export type ReturnReversalResult =
  | { outcome: 'created'; amount: number }
  | { outcome: 'exists' }
  /** The order has no commission entry (not delivered and collected, or a card order): nothing to give back. */
  | { outcome: 'no_commission' }
  /** The amount works out to 0 rupees, or the whole commission was already given back. */
  | { outcome: 'nothing' }
  | { outcome: 'failed' };

/**
 * When a refund is recorded for a cash on delivery order that has a commission entry, writes ONE reversal for the return: the opposite sign
 * of the original (balanceEffect positive), in whole rupees, = round(commission x returned base / order commission base), see
 * commissionReversal. The reversals of an order never add up to more than the original commission, and the one that brings the returned
 * base up to the order's own base takes the remainder. A repeat call finds the entry (the unique index { order, type, reversesType, returnId }
 * decides a race) and writes nothing. reverseLedgerForOrder (the full mirror of the cancel path) is left as it is. Never throws.
 */
export async function reverseForReturn(input: ReturnReversalInput): Promise<ReturnReversalResult> {
  if (!ledgerReady()) return { outcome: 'failed' };
  const orderId = String(input.order._id);
  try {
    const original = (await CommissionEntry.findOne({ order: input.order._id, type: 'cod_commission' }).lean()) as unknown as StoredEntry | null;
    if (!original) return { outcome: 'no_commission' };
    const reversals = (await CommissionEntry.find({ order: input.order._id, type: 'reversal', reversesType: 'cod_commission' }).lean()) as unknown as Array<StoredEntry & { returnId?: unknown }>;
    if (reversals.some((entry) => entry.returnId !== undefined && entry.returnId !== null && String(entry.returnId) === String(input.returnId))) return { outcome: 'exists' };

    const previousBase = reversals.reduce((sum, entry) => sum + num(entry.baseAmount), 0);
    const previousAmount = reversals.reduce((sum, entry) => sum + num(entry.balanceEffect), 0);
    const commission = Math.max(0, -num(original.balanceEffect));
    // SB-7 (re-verification bug 2): the completing return keeps back what the earlier received returns WITHOUT a reversal yet will still get
    // (round(commission x their cap / order base), the rule of a normal return), so it never takes their share.
    const orderBase = num(original.baseAmount);
    const reversed = new Set(reversals.filter((entry) => entry.returnId !== undefined && entry.returnId !== null).map((entry) => String(entry.returnId)));
    const reservedForEarlier =
      input.completesOrder === true && orderBase > 0
        ? (input.earlierReturns ?? []).filter((earlier) => !reversed.has(String(earlier.returnId)) && String(earlier.returnId) !== String(input.returnId)).reduce((sum, earlier) => sum + Math.round((commission * Math.max(0, earlier.base)) / orderBase), 0)
        : 0;
    const amount = commissionReversal({ commission, orderBase, returnedBase: input.returnedBase, previousBase, previousAmount, completesOrder: input.completesOrder === true, reservedForEarlier });
    if (amount <= 0) return { outcome: 'nothing' };

    // The base recorded is what this return really adds to the order's returned base, so the next return's remainder check is exact.
    const base = Math.min(Math.max(0, Math.round(input.returnedBase)), Math.max(0, num(original.baseAmount) - previousBase));
    const outcome = await writeEntry({
      store: original.store,
      order: original.order,
      type: 'reversal',
      balanceEffect: amount,
      baseAmount: base,
      rate: original.rate,
      reversesType: 'cod_commission',
      returnId: input.returnId,
    });
    if (outcome === 'exists') return { outcome: 'exists' };
    try {
      // The audit entry holds ids and the rupee amount only.
      await writeAuditLog('commission.reversal', 'order', orderId, 'system:commission', { returnId: String(input.returnId), amount, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the return reversal audit entry', { orderId, error: errorName(err) });
    }
    return { outcome: 'created', amount };
  } catch (err) {
    console.error('[seller-backend] could not write the return commission reversal', { orderId, error: errorName(err) });
    return { outcome: 'failed' };
  }
}
