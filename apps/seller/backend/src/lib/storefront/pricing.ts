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

export interface OrderTotals {
  subtotal: number;
  deliveryCharges: number;
  total: number;
}

/** PKR amounts are whole rupees in practice; rounding to paisa only removes float noise from the sums. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeTotals(lines: PricingLine[], store: PricingStore): OrderTotals {
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
  deliveryCharges = roundMoney(deliveryCharges);

  return { subtotal, deliveryCharges, total: roundMoney(subtotal + deliveryCharges) };
}
