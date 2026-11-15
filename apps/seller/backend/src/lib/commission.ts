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

/** The store's custom rate when it has one (mode custom and a valid rate), else the platform default; one decimal. */
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
const errorName = (err: unknown): string => (err instanceof Error ? err.name + ': ' + err.message.slice(0, 200) : 'unknown');

interface NewEntry {
  store: unknown;
  order: unknown;
  type: 'cod_commission' | 'card_sale' | 'card_commission' | 'reversal';
  balanceEffect: number;
  baseAmount: number;
  rate: number;
  reversesType?: 'cod_commission' | 'card_sale' | 'card_commission' | null;
}

/** Writes one entry. 'exists' when the unique index says it is already there. Throws on any other failure. */
async function writeEntry(entry: NewEntry): Promise<'created' | 'exists'> {
  try {
    await CommissionEntry.create({
      ...entry,
      balanceEffect: entry.balanceEffect === 0 ? 0 : entry.balanceEffect,
      reversesType: entry.reversesType ?? null,
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
 * sees both states writes, and a second one finds the entry. Never throws.
 */
export async function recordCodCommission(order: LedgerOrder): Promise<'created' | 'exists' | 'not_due' | 'failed'> {
  if (!codCommissionDue(order)) return 'not_due';
  if (!ledgerReady()) return 'failed';
  try {
    const { rate } = await commissionRateAndSource(await storeRateFields(order.store));
    const base = commissionBase(order);
    const result = await writeEntry({ store: order.store, order: order._id, type: 'cod_commission', balanceEffect: -commissionFor(base, rate), baseAmount: base, rate });
    return result;
  } catch (err) {
    console.error('[seller-backend] could not write the COD commission entry', { orderId: String(order._id), error: errorName(err) });
    return 'failed';
  }
}

/** The card sale and its commission, once the order is paid. Each entry is idempotent on its own. Never throws. */
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
