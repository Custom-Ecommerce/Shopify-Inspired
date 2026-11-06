import { CommissionLedgerModel } from './commission-ledger';
import { StripeEventModel } from './stripe-events';
import { SubscriptionPlanModel } from './subscription-plans';
import { Store } from '../models/store';
import { User } from '../models/user';

/** A Mongo duplicate-key error (code 11000). */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * The persistence the billing package needs, built on the shared models (ID-18). Each app registers it at boot:
 * registerBillingPorts(billingPortsImpl). It is checked structurally against BillingPorts at each call site.
 *
 * Units: commission is a percentage everywhere (4 means 4%), as the ledger stores it.
 * Store billing ids live under the store's billing group, which is Mixed in the model.
 */
export const billingPortsImpl = {
  ledger: {
    create: async (doc: Record<string, unknown>): Promise<unknown> => CommissionLedgerModel.create(doc),
  },

  /** Claims a Stripe event id once. A repeat delivery returns false, so it is not processed again. */
  async claimWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
    try {
      await StripeEventModel.create({ _id: eventId, type: eventType });
      return true;
    } catch (err) {
      if (isDuplicateKey(err)) return false;
      throw err;
    }
  },

  /** Releases a claim after a failed attempt, so Stripe's retry can process the event. */
  async releaseWebhookEvent(eventId: string): Promise<void> {
    await StripeEventModel.deleteOne({ _id: eventId });
  },

  /** Writes the subscription onto the store. A cancellation with no store is acknowledged and not stored. */
  async upsertSubscription(input: {
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    stripePriceId: string;
    status: string;
    storeId: string | null;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    if (!input.storeId) return;
    await Store.updateOne(
      { _id: input.storeId },
      {
        $set: {
          'billing.stripeSubscriptionId': input.stripeSubscriptionId,
          'billing.stripeCustomerId': input.stripeCustomerId,
          'billing.stripePriceId': input.stripePriceId,
          'billing.stripeSubscriptionStatus': input.status,
          'billing.cancelAtPeriodEnd': input.cancelAtPeriodEnd,
        },
      },
    );
  },

  /** The ledger row for a payment intent, found by its id. A refund reads the rate the sale was recorded at. */
  async findSaleByPaymentIntent(paymentIntentId: string): Promise<{
    store: string;
    orderId: string;
    sellerOrderDocId: string | null;
    commissionRate: number;
    paymentMethod: string | null;
    stripePaymentIntentId: string;
  } | null> {
    const row = (await CommissionLedgerModel.findOne({ stripePaymentIntentId: paymentIntentId, refundId: null }).lean()) as
      | Record<string, unknown>
      | null;
    if (!row || row.commissionRate === null || row.commissionRate === undefined) return null;
    return {
      store: String(row.store),
      orderId: String(row.orderId),
      sellerOrderDocId: row.sellerOrderDocId ? String(row.sellerOrderDocId) : null,
      commissionRate: Number(row.commissionRate),
      paymentMethod: row.paymentMethod ? String(row.paymentMethod) : null,
      stripePaymentIntentId: String(row.stripePaymentIntentId),
    };
  },

  /** The plan for a Stripe price id. */
  async findPlanByPriceId(priceId: string): Promise<{ name: string; stripePriceId: string; tier: string } | null> {
    const plan = (await SubscriptionPlanModel.findOne({ stripePriceId: priceId }).lean()) as
      | { name: string; stripePriceId: string; tier: string }
      | null;
    return plan ? { name: plan.name, stripePriceId: plan.stripePriceId, tier: plan.tier } : null;
  },

  /** The seller's store for a signed-in actor (a user id). Stores are PK, the launch market. */
  async findSellerStoreForActor(actorId: string): Promise<{
    storeId: string;
    ownerEmail: string;
    countryCode: string;
    stripeCustomerId: string | null;
    stripeAccountId: string | null;
  } | null> {
    const user = (await User.findById(actorId).select('store email').lean()) as { store?: unknown; email?: string } | null;
    if (!user || !user.store) return null;
    const store = (await Store.findById(user.store).select('billing').lean()) as
      | { billing?: { stripeCustomerId?: string; stripeAccountId?: string } }
      | null;
    if (!store) return null;
    return {
      storeId: String(user.store),
      ownerEmail: String(user.email ?? ''),
      countryCode: 'PK',
      stripeCustomerId: store.billing?.stripeCustomerId ?? null,
      stripeAccountId: store.billing?.stripeAccountId ?? null,
    };
  },

  /** Stores the Stripe customer and account ids under the store's billing group. */
  async saveStoreBilling(storeId: string, patch: { stripeCustomerId?: string; stripeAccountId?: string }): Promise<void> {
    const $set: Record<string, string> = {};
    if (patch.stripeCustomerId !== undefined) $set['billing.stripeCustomerId'] = patch.stripeCustomerId;
    if (patch.stripeAccountId !== undefined) $set['billing.stripeAccountId'] = patch.stripeAccountId;
    if (Object.keys($set).length === 0) return;
    await Store.updateOne({ _id: storeId }, { $set });
  },
};
