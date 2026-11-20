import type { StoreReadiness, StoreReadinessItem } from '@markaz/contracts';
import type { AuthContext } from '@/lib/auth';
import { isEmailVerified } from '@/lib/account-support';
import { Product } from '@/lib/services';
import { cardPaymentsAvailable } from '@/lib/storefront/card-config';
import { liveProductFilter } from '@/lib/storefront/live-product';
import { readPayments, readPayout, record, type StoreDoc } from '@/lib/store-settings';

/**
 * Sprint 4 EP-04.US06 (D-094): the go-live checklist. Every item must pass before a store can go live:
 *   profile   a name, a contact phone or WhatsApp number, and a city
 *   delivery  a delivery rate saved (0 is a valid "free delivery" choice, but it must be chosen)
 *   payment   at least one method shoppers can use: COD on, or card on with the platform keys set
 *   payout    payout details saved (D-088)
 *   product   at least one published product that is not a demo, trashed or taken down
 *   email     the seller's email verified (D-093, the SB-3 helper)
 */

const LABELS: Record<StoreReadinessItem, { label: string; tab: string }> = {
  profile: { label: 'Add the store name, a contact number and the city', tab: 'profile' },
  delivery: { label: 'Set your delivery rate', tab: 'delivery' },
  payment: { label: 'Turn on at least one payment method', tab: 'payments' },
  payout: { label: 'Add where we pay you (bank, JazzCash or Easypaisa)', tab: 'payments' },
  product: { label: 'Publish at least one product', tab: 'products' },
  email: { label: 'Verify your email address', tab: 'account' },
};

export async function storeReadiness(doc: StoreDoc, ctx: AuthContext): Promise<StoreReadiness> {
  const sf = record(doc.storefront);
  const text = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';
  const payments = readPayments(doc.paymentSettings);

  const [hasProduct, emailVerified] = await Promise.all([
    // The storefront's own "live" rule, so the checklist counts exactly what shoppers would see.
    Product.exists(liveProductFilter(String(doc._id))),
    isEmailVerified(ctx),
  ]);

  const checks: Record<StoreReadinessItem, boolean> = {
    profile: text(doc.name) && (text(sf.contactPhone) || text(sf.whatsappNumber)) && text(sf.city),
    delivery: typeof sf.deliveryRate === 'number' && Number.isFinite(sf.deliveryRate) && sf.deliveryRate >= 0,
    payment: payments.codEnabled || (payments.cardEnabled && cardPaymentsAvailable()),
    payout: readPayout(doc.payoutDetails) !== null,
    product: Boolean(hasProduct),
    email: emailVerified,
  };
  const items = (Object.keys(LABELS) as StoreReadinessItem[]).map((key) => ({ key, ok: checks[key], ...LABELS[key] }));
  const missing = items.filter((item) => !item.ok).map((item) => item.key);
  return { ready: missing.length === 0, status: String(doc.status ?? 'pending'), items, missing };
}
