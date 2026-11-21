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

// ---------------------------------------------------------------------------------------------------------------------
// CO-73 (Sprint 6): findSellerStoreForActor no longer assumes User.store.

import { User } from '../src/models/user';

const OWNER = '65a000000000000000000007';
const OWN_STORE = '65a0000000000000000000a1';
const OLDER_STORE = '65a0000000000000000000a0';
const OTHER_STORE = '65a0000000000000000000b1';
const LEGACY_STORE = '65a0000000000000000000c1';

function stubStoreLookups(rows: Record<string, { owner: string; billing?: Record<string, string> }>, user: Record<string, unknown> | null) {
  const originals = { userFindById: (User as any).findById, findOne: (Store as any).findOne, findById: (Store as any).findById };
  const seen = { findOne: [] as any[], findById: [] as string[] };
  const chain = (value: () => unknown) => {
    const q: any = { select: () => q, sort: () => q, lean: async () => value() };
    return q;
  };
  (User as any).findById = () => chain(() => user);
  (Store as any).findOne = (filter: any) => {
    seen.findOne.push(filter);
    return chain(() => {
      const ids = Object.keys(rows).sort();
      const id = filter._id !== undefined ? ids.find((candidate) => candidate === String(filter._id) && rows[candidate]!.owner === String(filter.owner)) : ids.find((candidate) => rows[candidate]!.owner === String(filter.owner));
      return id === undefined ? null : { _id: id, billing: rows[id]!.billing };
    });
  };
  (Store as any).findById = (id: unknown) => {
    seen.findById.push(String(id));
    return chain(() => (rows[String(id)] ? { _id: String(id), billing: rows[String(id)]!.billing } : null));
  };
  return {
    seen,
    restore: () => {
      (User as any).findById = originals.userFindById;
      (Store as any).findOne = originals.findOne;
      (Store as any).findById = originals.findById;
    },
  };
}

test('CO-73: with no store given, the seller\'s oldest OWNED store is used, whatever User.store says', async () => {
  const stub = stubStoreLookups({ [OLDER_STORE]: { owner: OWNER }, [OWN_STORE]: { owner: OWNER }, [OTHER_STORE]: { owner: 'someone-else' } }, { email: 'a@example.com', store: OTHER_STORE });
  try {
    const found = await billingPortsImpl.findSellerStoreForActor(OWNER);
    assert.equal(found?.storeId, OLDER_STORE);
    assert.equal(found?.ownerEmail, 'a@example.com');
    assert.deepEqual(stub.seen.findOne[0], { owner: OWNER });
    assert.equal(stub.seen.findById.length, 0, 'User.store is not read when the seller owns a store');
  } finally {
    stub.restore();
  }
});

test('CO-73: a given store is used only if the seller owns it; another seller\'s store is null', async () => {
  const stub = stubStoreLookups({ [OWN_STORE]: { owner: OWNER, billing: { stripeCustomerId: 'cus_1' } }, [OTHER_STORE]: { owner: 'someone-else' } }, { email: 'a@example.com' });
  try {
    const mine = await billingPortsImpl.findSellerStoreForActor(OWNER, OWN_STORE);
    assert.equal(mine?.storeId, OWN_STORE);
    assert.equal(mine?.stripeCustomerId, 'cus_1');
    assert.equal(await billingPortsImpl.findSellerStoreForActor(OWNER, OTHER_STORE), null);
    assert.deepEqual(stub.seen.findOne[1], { _id: OTHER_STORE, owner: OWNER });
    assert.equal(stub.seen.findById.length, 0);
  } finally {
    stub.restore();
  }
});

test('CO-73: only a seller who owns no store falls back to the old User.store field', async () => {
  const stub = stubStoreLookups({ [LEGACY_STORE]: { owner: 'nobody' } }, { email: 'old@example.com', store: LEGACY_STORE });
  try {
    assert.equal((await billingPortsImpl.findSellerStoreForActor(OWNER))?.storeId, LEGACY_STORE);
    // ...but never when a store was asked for by id
    assert.equal(await billingPortsImpl.findSellerStoreForActor(OWNER, OWN_STORE), null);
  } finally {
    stub.restore();
  }
});

test('CO-73: an unknown user, or a seller with no store at all, is null', async () => {
  const none = stubStoreLookups({}, null);
  try {
    assert.equal(await billingPortsImpl.findSellerStoreForActor(OWNER), null);
  } finally {
    none.restore();
  }
  const noStore = stubStoreLookups({}, { email: 'a@example.com' });
  try {
    assert.equal(await billingPortsImpl.findSellerStoreForActor(OWNER), null);
  } finally {
    noStore.restore();
  }
});
