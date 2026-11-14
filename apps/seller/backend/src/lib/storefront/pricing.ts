import type { StorefrontDiscountError, StorefrontDiscountRefusal, StorefrontQuoteTotals } from '@markaz/contracts';
import { discountRefusalMessage, toWholeRupees } from '@/lib/contracts';

/**
 * Server-side cart and order pricing. Pure: no database, and the time is passed in. Prices come from the catalog rows the
 * server just read, never from the client. priceCart is the one function the cart quote and order placement both call, so
 * the total a shopper sees is the total they are charged.
 *
 * Delivery policy:
 *   - each line has a delivery charge: the product's own charge, or the store's default rate when the
 *     product has none;
 *   - an order ships as one parcel, so it pays the highest line charge once (not the sum);
 *   - the charge is waived when the subtotal reaches the store's free-delivery threshold. A threshold of
 *     null or 0 means the store has no free-delivery offer. The subtotal is the one before any discount.
 *
 * Discount policy (D-080): percent or whole rupees off the item subtotal only, never delivery. The total never goes below zero.
 */

export interface PricingLine {
  /** Needed only to match a code limited to certain products. */
  productId?: string;
  unitPrice: number;
  qty: number;
  /** The product's own delivery charge, or null to use the store default. */
  deliveryCharge: number | null;
}

export interface PricingStore {
  deliveryRate: number;
  freeDeliveryThreshold: number | null;
}

/** A Discount row as pricing reads it. */
export interface DiscountRule {
  _id: unknown;
  code: string;
  type: string;
  value: number;
  minOrderAmount?: number | null;
  maxUses?: number | null;
  usedCount?: number | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  applicableProducts?: readonly unknown[] | null;
  isActive?: boolean | null;
  archivedAt?: unknown;
}

/** The code a shopper sent and the row it found, which is null for a code this store does not have. */
export interface DiscountRequest {
  code: string;
  rule: DiscountRule | null;
}

export interface AppliedDiscount {
  discountId: string;
  code: string;
  amount: number;
  /** What the order keeps, so later changes to the code do not rewrite its history. */
  snapshot: { discountId: string; type: string; value: number; minOrderAmount: number | null };
}

export interface PricedCart {
  totals: StorefrontQuoteTotals;
  applied: AppliedDiscount | null;
  refusal: StorefrontDiscountError | null;
}

/** PKR amounts are whole rupees in practice; rounding to paisa only removes float noise from the sums. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeTotals(lines: PricingLine[], store: PricingStore, discount = 0): StorefrontQuoteTotals {
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0));

  const threshold = store.freeDeliveryThreshold;
  const freeDelivery = threshold !== null && threshold > 0 && subtotal >= threshold;

  let deliveryCharges = 0;
  if (!freeDelivery) {
    for (const line of lines) {
      const charge = line.deliveryCharge ?? store.deliveryRate;
      if (charge > deliveryCharges) deliveryCharges = charge;
    }
  }
  // Whole rupees (D-004), as the contract requires of an older product or store whose rate still has decimals.
  deliveryCharges = toWholeRupees(deliveryCharges) ?? 0;

  const afterDiscount = Math.max(0, subtotal - discount);
  return { subtotal, deliveryCharges, discount, total: roundMoney(afterDiscount + deliveryCharges) };
}

const timeOf = (value: Date | string | null | undefined): number | null => (value ? new Date(value).getTime() : null);

function linesTotal(lines: readonly PricingLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0));
}

/** The rupees this rule takes off, in whole rupees (D-004, nearest rupee), never more than the lines it counts. */
function discountAmount(rule: DiscountRule, base: number): number | null {
  if (rule.type === 'percentage') return rule.value >= 1 && rule.value <= 100 ? Math.min(base, Math.round((base * rule.value) / 100)) : null;
  if (rule.type === 'fixed_amount') {
    const rupees = toWholeRupees(rule.value);
    return rupees === null ? null : Math.min(base, rupees);
  }
  return null;
}

type Verdict = { ok: true; amount: number } | { ok: false; reason: StorefrontDiscountRefusal };

/**
 * Whether this rule can be used on these lines now. An unknown code, another store's code, an archived code and a type
 * from before D-080 are all the same answer, so a shopper cannot tell them apart.
 */
function judge(rule: DiscountRule | null, lines: readonly PricingLine[], now: Date): Verdict {
  if (rule === null || rule.archivedAt) return { ok: false, reason: 'unknown' };
  if (rule.type !== 'percentage' && rule.type !== 'fixed_amount') return { ok: false, reason: 'unknown' };
  if (rule.isActive === false) return { ok: false, reason: 'inactive' };

  const at = now.getTime();
  const starts = timeOf(rule.startDate);
  if (starts !== null && at < starts) return { ok: false, reason: 'not_started' };
  const ends = timeOf(rule.endDate);
  if (ends !== null && at > ends) return { ok: false, reason: 'expired' };

  if (typeof rule.maxUses === 'number' && (rule.usedCount ?? 0) >= rule.maxUses) return { ok: false, reason: 'used_up' };

  if (linesTotal(lines) < (rule.minOrderAmount ?? 0)) return { ok: false, reason: 'minimum_not_met' };

  const limitedTo = new Set((rule.applicableProducts ?? []).map((id) => String(id).toLowerCase()));
  const counted = limitedTo.size === 0 ? lines : lines.filter((line) => limitedTo.has(String(line.productId).toLowerCase()));

  const amount = discountAmount(rule, linesTotal(counted));
  if (amount === null) return { ok: false, reason: 'unknown' };
  // Nothing to take off: no matching line, or a percent too small to reach a rupee. A use is not spent on that.
  return amount > 0 ? { ok: true, amount } : { ok: false, reason: 'not_applicable' };
}

export function priceCart(lines: PricingLine[], store: PricingStore, discount: DiscountRequest | null, now: Date = new Date()): PricedCart {
  if (discount === null) return { totals: computeTotals(lines, store), applied: null, refusal: null };

  const verdict = judge(discount.rule, lines, now);
  if (!verdict.ok) {
    const message = discountRefusalMessage(verdict.reason, discount.rule?.minOrderAmount ?? null);
    return { totals: computeTotals(lines, store), applied: null, refusal: { reason: verdict.reason, message } };
  }

  const rule = discount.rule as DiscountRule;
  const discountId = String(rule._id);
  return {
    totals: computeTotals(lines, store, verdict.amount),
    applied: {
      discountId,
      code: rule.code,
      amount: verdict.amount,
      snapshot: { discountId, type: rule.type, value: rule.value, minOrderAmount: rule.minOrderAmount ?? null },
    },
    refusal: null,
  };
}
