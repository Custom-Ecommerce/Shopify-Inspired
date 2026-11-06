import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingPortsImpl } from '../src/billing/ports-impl';
import { StripeEventModel } from '../src/billing/stripe-events';
import { CommissionLedgerModel } from '../src/billing/commission-ledger';
import { Store } from '../src/models/store';

const STORE_ID = '65a000000000000000000001';

test('the implementation provides every BillingPorts method and the ledger writer', () => {
  for (const name of [
    'claimWebhookEvent',
    'releaseWebhookEvent',
    'upsertSubscription',
    'findSaleByPaymentIntent',
    'findPlanByPriceId',
    'findSellerStoreForActor',
    'saveStoreBilling',
  ]) {
    assert.equal(typeof (billingPortsImpl as any)[name], 'function', name);
  }
  assert.equal(typeof billingPortsImpl.ledger.create, 'function');
});

test('a Stripe event is claimed once: a repeat delivery is reported and not reprocessed', async () => {
  const original = (StripeEventModel as any).create;
  const seen: string[] = [];
  (StripeEventModel as any).create = async (doc: any) => {
    if (seen.includes(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    seen.push(doc._id);
    return doc;
  };
  try {
    assert.equal(await billingPortsImpl.claimWebhookEvent('evt_1', 'checkout.session.completed'), true);
    assert.equal(await billingPortsImpl.claimWebhookEvent('evt_1', 'checkout.session.completed'), false);
  } finally {
    (StripeEventModel as any).create = original;
  }
});

test('a sale is found by its payment intent, and its commission is read as a percentage', async () => {
  const original = (CommissionLedgerModel as any).findOne;
  (CommissionLedgerModel as any).findOne = (filter: any) => {
    assert.equal(filter.stripePaymentIntentId, 'pi_1');
    assert.equal(filter.refundId, null);
    return {
      lean: async () => ({
        store: STORE_ID,
        orderId: 'ORD-1',
        sellerOrderDocId: 'doc-1',
        commissionRate: 4,
        paymentMethod: 'card',
        stripePaymentIntentId: 'pi_1',
      }),
    };
  };
  try {
    const sale = await billingPortsImpl.findSaleByPaymentIntent('pi_1');
    assert.equal(sale?.commissionRate, 4);
    assert.equal(sale?.store, STORE_ID);
  } finally {
    (CommissionLedgerModel as any).findOne = original;
  }
});

test('a store\'s Stripe account id is written under the billing group, and only the fields given', async () => {
  const original = (Store as any).updateOne;
  const calls: Array<{ filter: any; update: any }> = [];
  (Store as any).updateOne = async (filter: any, update: any) => {
    calls.push({ filter, update });
    return { matchedCount: 1 };
  };
  try {
    await billingPortsImpl.saveStoreBilling(STORE_ID, { stripeAccountId: 'acct_1' });
    assert.deepEqual(calls[0].update, { $set: { 'billing.stripeAccountId': 'acct_1' } });
  } finally {
    (Store as any).updateOne = original;
  }
});
