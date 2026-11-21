import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbandonedCart, CommissionEntry, Review, Return, BlockedContact, Subscription, SubscriptionPlanModel } from '@/lib/services';
// @ts-expect-error plain .mjs script module without types; tests are not type-checked (tsconfig excludes test)
import * as planNs from '../../../../scripts/lib/ensure-indexes-plan.mjs';

// Sprint 5 EP-11.US04.T04 (D-111 (7)): the planning of scripts/ensure-indexes.mjs. The script itself is never run by a test (it needs a database); every
// decision it makes is in this pure module. It compares what the models declare with what a collection has, and never plans a drop.

type Declared = Array<[Record<string, number>, Record<string, unknown> | undefined]>;
type Existing = Array<{ name?: string; key?: Record<string, number>; unique?: boolean; sparse?: boolean; partialFilterExpression?: unknown; expireAfterSeconds?: number }>;
const plan = ((planNs as { default?: unknown }).default ?? planNs) as {
  targetDecision: (name: string, flags: { apply: boolean; iKnowThisIsReal: boolean }) => { ok: boolean; reason: string };
  sameKey: (a: Record<string, number>, b: Record<string, number>) => boolean;
  defaultIndexName: (key: Record<string, number>) => string;
  behaviourOf: (options?: Record<string, unknown>) => string;
  planCollection: (declared: Declared, existing: Existing) => { present: number; missing: Array<{ name: string; unique: boolean; ttl: boolean; partial: boolean }>; conflicts: Array<{ name: string; reason: string }> };
  planAll: (
    models: Array<{ model: string; collection: string; declared: Declared }>,
    existing: Record<string, Existing>,
  ) => { models: Array<{ model: string; missing: unknown[]; conflicts: unknown[] }>; totals: { present: number; missing: number; conflicts: number }; toCreate: string[] };
  isMissingCollection: (err: unknown) => boolean;
};

const ID = { name: '_id_', key: { _id: 1 } };

test('the guard is the one of the other scripts: a throwaway database alone, any other with --i-know-this-is-real, for the dry run too', () => {
  assert.deepEqual(plan.targetDecision('markaz-throwaway', { apply: true, iKnowThisIsReal: false }), { ok: true, reason: 'safe-name' });
  assert.deepEqual(plan.targetDecision('markaz', { apply: false, iKnowThisIsReal: false }), { ok: false, reason: 'needs-throwaway-name-or-flag' });
  assert.equal(plan.targetDecision('markaz', { apply: false, iKnowThisIsReal: true }).reason, 'confirmed-dry-run');
  assert.equal(plan.targetDecision('markaz', { apply: true, iKnowThisIsReal: true }).reason, 'confirmed-apply');
  assert.equal(plan.targetDecision('', { apply: false, iKnowThisIsReal: false }).ok, false);
});

test('names and keys: the default name of an index, and a key is the same only in the same order and direction', () => {
  assert.equal(plan.defaultIndexName({ store: 1, createdAt: -1 }), 'store_1_createdAt_-1');
  assert.equal(plan.sameKey({ a: 1, b: -1 }, { a: 1, b: -1 }), true);
  assert.equal(plan.sameKey({ a: 1, b: -1 }, { b: -1, a: 1 }), false);
  assert.equal(plan.sameKey({ a: 1 }, { a: -1 }), false);
});

test('a collection that does not exist yet misses every declared index, with the traits that matter', () => {
  const declared: Declared = [
    [{ store: 1, phone: 1 }, { unique: true, name: 'store_phone_open_unique', partialFilterExpression: { status: 'open' } }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' }],
    [{ store: 1 }, {}],
  ];
  const result = plan.planCollection(declared, []);
  assert.equal(result.present, 0);
  assert.deepEqual(result.missing.map((m) => [m.name, m.unique, m.ttl, m.partial]), [
    ['store_phone_open_unique', true, false, true],
    ['expires_ttl', false, true, false],
    ['store_1', false, false, false],
  ]);
  assert.deepEqual(result.conflicts, []);
});

test('an index that is there is present, whatever it is called, and a second run finds nothing missing', () => {
  const declared: Declared = [
    [{ order: 1, product: 1 }, { unique: true, name: 'order_product_unique', partialFilterExpression: { order: { $type: 'objectId' } } }],
    [{ store: 1, status: 1, createdAt: -1 }, {}],
  ];
  const existing: Existing = [
    ID,
    // built by hand under another name, the same key and behaviour
    { name: 'my_own_name', key: { order: 1, product: 1 }, unique: true, partialFilterExpression: { order: { $type: 'objectId' } } },
    { name: 'store_1_status_1_createdAt_-1', key: { store: 1, status: 1, createdAt: -1 } },
  ];
  const result = plan.planCollection(declared, existing);
  assert.equal(result.present, 2);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.conflicts, []);
});

test('the same key with another behaviour is not the same index: missing when no name is taken, a conflict when the declared name is taken', () => {
  const declared: Declared = [[{ order: 1, product: 1 }, { unique: true, name: 'order_product_unique' }]];
  // The same key exists, but not unique, under another name: the unique one is missing.
  const notUnique = plan.planCollection(declared, [ID, { name: 'order_1_product_1', key: { order: 1, product: 1 } }]);
  assert.equal(notUnique.missing.length, 1);
  assert.equal(notUnique.conflicts.length, 0);
  // The declared NAME exists with another definition: createIndex would fail with an options conflict, so it is reported and left alone.
  const taken = plan.planCollection(declared, [ID, { name: 'order_product_unique', key: { order: 1, product: 1 } }]);
  assert.equal(taken.missing.length, 0);
  assert.equal(taken.conflicts.length, 1);
  assert.match(taken.conflicts[0]!.reason, /different/);
  // A TTL with another number of seconds is another behaviour.
  assert.equal(plan.behaviourOf({ expireAfterSeconds: 0 }) === plan.behaviourOf({ expireAfterSeconds: 60 }), false);
  assert.equal(plan.behaviourOf({ partialFilterExpression: { a: 1, b: 2 } }), plan.behaviourOf({ partialFilterExpression: { b: 2, a: 1 } }), 'key order of a filter does not matter');
  assert.equal(plan.behaviourOf({ background: true, name: 'x' }), plan.behaviourOf({}), 'the name and background are not behaviour');
});

test('an index nobody declares is never planned for removal: the plan has no drop at all', () => {
  const result = plan.planCollection([[{ a: 1 }, {}]], [ID, { name: 'old_unique', key: { z: 1 }, unique: true }, { name: 'a_1', key: { a: 1 } }]);
  assert.equal(result.present, 1);
  assert.deepEqual(Object.keys(result).sort(), ['conflicts', 'missing', 'present']);
});

test('planAll: totals, the models to create, a model with a conflict is skipped, and a collection shared by two models is planned once', () => {
  const models = [
    { model: 'Review', collection: 'reviews', declared: [[{ order: 1, product: 1 }, { unique: true, name: 'order_product_unique' }]] as Declared },
    { model: 'Return', collection: 'returns', declared: [[{ store: 1 }, {}]] as Declared },
    { model: 'Clash', collection: 'clashes', declared: [[{ a: 1 }, { unique: true, name: 'a_1' }], [{ b: 1 }, {}]] as Declared },
    { model: 'ReviewAgain', collection: 'reviews', declared: [[{ x: 1 }, {}]] as Declared },
  ];
  const result = plan.planAll(models, { returns: [ID, { name: 'store_1', key: { store: 1 } }], clashes: [ID, { name: 'a_1', key: { a: 1 } }] });
  assert.deepEqual(result.models.map((m) => m.model), ['Review', 'Return', 'Clash']);
  assert.deepEqual(result.totals, { present: 1, missing: 2, conflicts: 1 });
  assert.deepEqual(result.toCreate, ['Review']);
});

test('the real Sprint 5 models: a fresh database misses the review unique, the abandoned cart unique and TTL, and an empty plan stays valid', () => {
  const declared = (model: { schema: { indexes: () => unknown } }): Declared => model.schema.indexes() as Declared;
  const models = [
    { model: 'Review', collection: 'reviews', declared: declared(Review as never) },
    { model: 'AbandonedCart', collection: 'abandonedcarts', declared: declared(AbandonedCart as never) },
    { model: 'Return', collection: 'returns', declared: declared(Return as never) },
    { model: 'BlockedContact', collection: 'blockedcontacts', declared: declared(BlockedContact as never) },
    { model: 'CommissionEntry', collection: 'commissionentries', declared: declared(CommissionEntry as never) },
  ];
  const fresh = plan.planAll(models, {});
  assert.equal(fresh.totals.present, 0);
  assert.equal(fresh.totals.conflicts, 0);
  assert.deepEqual(fresh.toCreate, ['Review', 'AbandonedCart', 'Return', 'BlockedContact', 'CommissionEntry']);
  const cart = fresh.models.find((m) => m.model === 'AbandonedCart') as unknown as { missing: Array<{ name: string; unique: boolean; ttl: boolean }> };
  assert.ok(cart.missing.some((m) => m.name === 'expires_ttl' && m.ttl), 'the 7 day expiry');
  assert.ok(cart.missing.some((m) => m.name === 'store_phone_open_unique' && m.unique), 'one open cart per store and phone');
  const review = fresh.models.find((m) => m.model === 'Review') as unknown as { missing: Array<{ name: string; unique: boolean }> };
  assert.ok(review.missing.some((m) => m.name === 'order_product_unique' && m.unique), 'one review per order and product');
});

test('a missing collection is the driver\'s NamespaceNotFound (code 26), nothing else', () => {
  assert.equal(plan.isMissingCollection({ code: 26 }), true);
  assert.equal(plan.isMissingCollection({ codeName: 'NamespaceNotFound' }), true);
  assert.equal(plan.isMissingCollection({ code: 13 }), false);
  assert.equal(plan.isMissingCollection(null), false);
  assert.equal(plan.isMissingCollection(new Error('x')), false);
});

test('Sprint 6 EP-14: a fresh database misses the unique, partial index on the subscription plan key, and nothing conflicts', () => {
  const declared = (SubscriptionPlanModel as unknown as { schema: { indexes: () => unknown } }).schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'SubscriptionPlan', collection: 'subscriptionPlans', declared }], {});
  assert.deepEqual(fresh.toCreate, ['SubscriptionPlan']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean; partial: boolean }> }).missing;
  assert.ok(missing.some((m) => m.name === 'plan_key_unique' && m.unique && m.partial), 'one plan per key, old plans without a key excluded');
});

test('Sprint 6 EP-14: once the plan key index exists the plan finds nothing missing, and a plain (non unique) index on the same key does not count', () => {
  const declared = (SubscriptionPlanModel as unknown as { schema: { indexes: () => unknown } }).schema.indexes() as Declared;
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.keys(key).join('_') + '_1', key, ...(options as object) }));
  const done = plan.planAll([{ model: 'SubscriptionPlan', collection: 'subscriptionPlans', declared }], { subscriptionPlans: [ID, ...have] });
  assert.equal(done.totals.missing, 0);
  assert.deepEqual(done.toCreate, []);
  const plain = plan.planAll([{ model: 'SubscriptionPlan', collection: 'subscriptionPlans', declared }], { subscriptionPlans: [ID, { name: 'key_1', key: { key: 1 } }] });
  assert.ok(plain.totals.missing >= 1, 'a non-unique index on the key does not stand in for the unique one');
});

test('CO-115 (Sprint 6): a fresh database misses the unique index on subscription.seller (one subscription per seller), and nothing conflicts', () => {
  const declared = (Subscription as unknown as { schema: { indexes: () => unknown } }).schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'Subscription', collection: 'subscriptions', declared }], {});
  assert.deepEqual(fresh.toCreate, ['Subscription']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean; partial: boolean }> }).missing;
  assert.ok(missing.some((m) => m.name === 'seller_unique' && m.unique && !m.partial), 'a unique seller index with no partial filter: every subscription has a seller');
  assert.ok(missing.some((m) => m.name === 'status_period_end' && !m.unique), 'the expiry job index');
});

test('CO-115: once the subscription indexes exist the plan finds nothing missing, and a plain index on seller does not stand in for the unique one', () => {
  const declared = (Subscription as unknown as { schema: { indexes: () => unknown } }).schema.indexes() as Declared;
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.keys(key).join('_') + '_1', key, ...(options as object) }));
  const done = plan.planAll([{ model: 'Subscription', collection: 'subscriptions', declared }], { subscriptions: [ID, ...have] });
  assert.equal(done.totals.missing, 0);
  assert.deepEqual(done.toCreate, []);
  const plain = plan.planAll([{ model: 'Subscription', collection: 'subscriptions', declared }], { subscriptions: [ID, { name: 'seller_1', key: { seller: 1 } }] });
  assert.ok(plain.totals.missing >= 1, 'a non-unique index on seller is not the unique one');
});

test('CO-115: every model that declares a unique index is one the ensure-indexes plan sees: the subscription model is registered like the others', () => {
  const models = [{ model: 'Subscription', collection: 'subscriptions', declared: (Subscription as unknown as { schema: { indexes: () => unknown } }).schema.indexes() as Declared }];
  assert.equal(plan.planAll(models, {}).models[0]!.model, 'Subscription');
  assert.equal((Subscription as unknown as { collection: { name: string } }).collection.name, 'subscriptions');
});
