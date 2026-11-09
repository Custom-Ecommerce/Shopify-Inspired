import type { StorefrontQuoteTotals } from '@markaz/contracts';
import { toWholeRupees } from '@/lib/contracts';

/**
 * Server-side order pricing. Pure: no database, no clock. Prices come from the catalog rows the server
 * just read, never from the client.
 *
 * Delivery policy:
 *   - each line has a delivery charge: the product's own charge, or the store's default rate when the
 *     product has none;
 *   - an order ships as one parcel, so it pays the highest line charge once (not the sum);
 *   - the charge is waived when the subtotal reaches the store's free-delivery threshold. A threshold of
 *     null or 0 means the store has no free-delivery offer.
 *
 * The answer is the shared totals contract, used by the cart quote and the order service alike.
 */

export interface PricingLine {
  unitPrice: number;
  qty: number;
  /** The product's own delivery charge, or null to use the store default. */
  deliveryCharge: number | null;
}

export interface PricingStore {
  deliveryRate: number;
  freeDeliveryThreshold: number | null;
}

/** PKR amounts are whole rupees in practice; rounding to paisa only removes float noise from the sums. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeTotals(lines: PricingLine[], store: PricingStore): StorefrontQuoteTotals {
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

  // Discount codes arrive with D-080. Until then nothing comes off.
  return { subtotal, deliveryCharges, discount: 0, total: roundMoney(subtotal + deliveryCharges) };
}
