import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbandonedCart, Store, CommissionEntry, Review, Return, BlockedContact, Subscription, SubscriptionPayment, SubscriptionPlanModel } from '@/lib/services';
import * as dbSchemas from '@markaz/db-schemas';
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

test('Sprint 6 (S6-B4): a fresh database misses the unique PARTIAL index that keeps one open payment per seller, and nothing conflicts', () => {
  const declared = (SubscriptionPayment as unknown as { schema: { indexes: () => unknown } }).schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'SubscriptionPayment', collection: 'subscriptionPayments', declared }], {});
  assert.deepEqual(fresh.toCreate, ['SubscriptionPayment']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean; partial: boolean }> }).missing;
  assert.ok(missing.some((m) => m.name === 'seller_open_unique' && m.unique && m.partial), 'unique, and only over the open payments: a decided payment never collides');
  assert.ok(missing.some((m) => m.name === 'seller_status' && !m.unique), 'the {seller, status} index');
  assert.equal((SubscriptionPayment as unknown as { collection: { name: string } }).collection.name, 'subscriptionPayments');
});

test('Sprint 6 (S6-B4): the open-payment index is a unique index on seller whose partial filter is the equality isOpen true (no $in)', () => {
  const declared = (SubscriptionPayment as unknown as { schema: { indexes: () => Array<[Record<string, number>, Record<string, any> | undefined]> } }).schema.indexes();
  const unique = declared.filter(([, options]) => options?.unique === true);
  assert.equal(unique.length, 1, 'the only unique index of the model');
  assert.deepEqual(unique[0]![0], { seller: 1 });
  assert.deepEqual(unique[0]![1]!.partialFilterExpression, { isOpen: true });
});

test('Sprint 6 (S6-B4): once the payment indexes exist nothing is missing, and a plain or a non-partial unique index on seller does not stand in for the partial one', () => {
  const declared = (SubscriptionPayment as unknown as { schema: { indexes: () => unknown } }).schema.indexes() as Declared;
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.keys(key).join('_') + '_1', key, ...(options as object) }));
  const done = plan.planAll([{ model: 'SubscriptionPayment', collection: 'subscriptionPayments', declared }], { subscriptionPayments: [ID, ...have] });
  assert.equal(done.totals.missing, 0);
  assert.deepEqual(done.toCreate, []);
  const plain = plan.planAll([{ model: 'SubscriptionPayment', collection: 'subscriptionPayments', declared }], { subscriptionPayments: [ID, { name: 'seller_1', key: { seller: 1 } }] });
  assert.ok(plain.totals.missing >= 1, 'a plain index on seller is not the partial unique one');
  const wholeUnique = plan.planAll([{ model: 'SubscriptionPayment', collection: 'subscriptionPayments', declared }], { subscriptionPayments: [ID, { name: 'seller_1', key: { seller: 1 }, unique: true }] });
  assert.ok(wholeUnique.totals.missing + wholeUnique.totals.conflicts >= 1, 'a unique index over EVERY payment would forbid a second payment ever; it is not the same index');
});

test('Sprint 6 (S6-B7): a fresh database misses the unique {store, group} index of the sync revision log, and once it exists nothing is missing', () => {
  const model = (dbSchemas as any).StoreSyncRevision ?? (dbSchemas as any).default?.StoreSyncRevision;
  const declared = model.schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'StoreSyncRevision', collection: 'storeSyncRevisions', declared }], {});
  assert.deepEqual(fresh.toCreate, ['StoreSyncRevision']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean; partial: boolean }> }).missing;
  assert.ok(missing.some((m) => m.name === 'store_group_unique' && m.unique && !m.partial), 'one acknowledged revision row per (store, group)');
  assert.equal(model.collection.name, 'storeSyncRevisions');
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.keys(key).join('_') + '_1', key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'StoreSyncRevision', collection: 'storeSyncRevisions', declared }], { storeSyncRevisions: [ID, ...have] }).totals.missing, 0);
});

test('Sprint 7 (S7-B2, CO-115): the article model declares the unique {store, slug} index and the {store, mediaRefs} index, a fresh database misses both, and once they exist nothing is missing', () => {
  const model = (dbSchemas as any).StoreArticle ?? (dbSchemas as any).default?.StoreArticle;
  const declared = model.schema.indexes() as Declared;
  const keys = declared.map(([key]) => Object.keys(key).join('+'));
  assert.ok(keys.includes('store+slug'), 'a slug is unique per store');
  assert.ok(keys.includes('store+mediaRefs'), 'the media registry asks which articles use a file');
  const unique = declared.filter(([, options]) => (options as { unique?: boolean } | undefined)?.unique === true);
  assert.deepEqual(unique.map(([key]) => key), [{ store: 1, slug: 1 }], 'only the slug index is unique');
  const fresh = plan.planAll([{ model: 'StoreArticle', collection: 'storearticles', declared }], {});
  assert.deepEqual(fresh.toCreate, ['StoreArticle']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean }> }).missing;
  assert.ok(missing.some((m) => m.name === 'store_1_slug_1' && m.unique), 'the unique slug index is planned');
  assert.ok(missing.some((m) => m.name === 'store_1_mediaRefs_1' && !m.unique));
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'StoreArticle', collection: 'storearticles', declared }], { storearticles: [ID, ...have] }).totals.missing, 0);
  // A plain (non-unique) index on the same key does not stand in for the unique one.
  const plain = plan.planAll([{ model: 'StoreArticle', collection: 'storearticles', declared }], { storearticles: [ID, { name: 'store_1_slug_1', key: { store: 1, slug: 1 } }] });
  assert.ok(plain.totals.missing + plain.totals.conflicts >= 1);
});

test('Sprint 7 (S7-B3, CO-115): the page model declares the unique {store, slug} index, the {store, mediaRefs} index and the footer lookup, a fresh database misses all of them, and once they exist nothing is missing', () => {
  const model = (dbSchemas as any).StorePage ?? (dbSchemas as any).default?.StorePage;
  const declared = model.schema.indexes() as Declared;
  const keys = declared.map(([key]) => Object.keys(key).join('+'));
  assert.ok(keys.includes('store+slug'), 'a slug is unique per store');
  assert.ok(keys.includes('store+mediaRefs'), 'the media registry asks which pages use a file');
  assert.ok(keys.includes('store+status+sortOrder'), 'the storefront lists published pages in footer order');
  const unique = declared.filter(([, options]) => (options as { unique?: boolean } | undefined)?.unique === true);
  assert.deepEqual(unique.map(([key]) => key), [{ store: 1, slug: 1 }], 'only the slug index is unique');
  const fresh = plan.planAll([{ model: 'StorePage', collection: 'storepages', declared }], {});
  assert.deepEqual(fresh.toCreate, ['StorePage']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean }> }).missing;
  assert.ok(missing.some((m) => m.name === 'store_1_slug_1' && m.unique), 'the unique slug index is planned');
  assert.ok(missing.some((m) => m.name === 'store_1_mediaRefs_1' && !m.unique));
  assert.ok(missing.some((m) => m.name === 'store_1_status_1_sortOrder_1' && !m.unique));
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'StorePage', collection: 'storepages', declared }], { storepages: [ID, ...have] }).totals.missing, 0);
  const plain = plan.planAll([{ model: 'StorePage', collection: 'storepages', declared }], { storepages: [ID, { name: 'store_1_slug_1', key: { store: 1, slug: 1 } }] });
  assert.ok(plain.totals.missing + plain.totals.conflicts >= 1, 'a plain index on the same key is not the unique one');
});

test('Sprint 7 (S7-B4, CO-115): the contact message model declares {store, status, createdAt} and {scope, status, createdAt}, a fresh database misses both, and once they exist nothing is missing', () => {
  const model = (dbSchemas as any).ContactMessage ?? (dbSchemas as any).default?.ContactMessage;
  const declared = model.schema.indexes() as Declared;
  const keys = declared.map(([key]) => Object.entries(key).map(([k, d]) => k + ':' + d).join('+'));
  assert.ok(keys.includes('store:1+status:1+createdAt:-1'), 'the seller inbox');
  assert.ok(keys.includes('scope:1+status:1+createdAt:-1'), 'the admin inbox');
  assert.equal(declared.filter(([, options]) => (options as { unique?: boolean } | undefined)?.unique === true).length, 0, 'nothing here is unique');
  const fresh = plan.planAll([{ model: 'ContactMessage', collection: 'contactmessages', declared }], {});
  assert.deepEqual(fresh.toCreate, ['ContactMessage']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string }> }).missing.map((m) => m.name);
  assert.ok(missing.includes('store_1_status_1_createdAt_-1'));
  assert.ok(missing.includes('scope_1_status_1_createdAt_-1'));
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'ContactMessage', collection: 'contactmessages', declared }], { contactmessages: [ID, ...have] }).totals.missing, 0);
});

test('Sprint 7 (S7-B4, CO-115): the ticket model declares {seller, createdAt} and {status, updatedAt}, a fresh database misses both, and once they exist nothing is missing', () => {
  const model = (dbSchemas as any).SupportTicket ?? (dbSchemas as any).default?.SupportTicket;
  const declared = model.schema.indexes() as Declared;
  const keys = declared.map(([key]) => Object.entries(key).map(([k, d]) => k + ':' + d).join('+'));
  assert.ok(keys.includes('seller:1+createdAt:-1'), 'a seller own tickets');
  assert.ok(keys.includes('status:1+updatedAt:-1'), 'the admin inbox and the retention purge');
  const fresh = plan.planAll([{ model: 'SupportTicket', collection: 'supporttickets', declared }], {});
  assert.deepEqual(fresh.toCreate, ['SupportTicket']);
  assert.equal(fresh.totals.conflicts, 0);
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'SupportTicket', collection: 'supporttickets', declared }], { supporttickets: [ID, ...have] }).totals.missing, 0);
});

test('Sprint 7 (S7-B5): the store model declares a UNIQUE PARTIAL index on domain (only a string), a fresh database misses it, and a plain or sparse one does not stand in for it', () => {
  const declared = (Store as unknown as { schema: { indexes: () => Array<[Record<string, number>, Record<string, any> | undefined]> } }).schema.indexes();
  const domain = declared.filter(([key]) => Object.keys(key).length === 1 && key.domain === 1);
  assert.equal(domain.length, 1, 'one index on domain: the old non-unique sparse one is replaced');
  assert.equal(domain[0]![1]!.unique, true);
  assert.deepEqual(domain[0]![1]!.partialFilterExpression, { domain: { $type: 'string' } });
  assert.equal(domain[0]![1]!.sparse, undefined);

  const typed = declared as unknown as Declared;
  const fresh = plan.planAll([{ model: 'Store', collection: 'stores', declared: typed }], {});
  assert.ok(fresh.toCreate.includes('Store'));
  assert.equal(fresh.totals.conflicts, 0);
  const missingDomain = fresh.models[0]!.missing as Array<{ name: string; unique: boolean; partial: boolean }>;
  assert.ok(missingDomain.some((m) => m.name === 'domain_1' && m.unique && m.partial));

  const ID = { name: '_id_', key: { _id: 1 } };
  const have = typed.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'Store', collection: 'stores', declared: typed }], { stores: [ID, ...have] }).totals.missing, 0);

  // The old index (non-unique, sparse, same name) is reported as a conflict to resolve by hand, never dropped by the plan.
  const old = plan.planAll([{ model: 'Store', collection: 'stores', declared: typed }], { stores: [ID, ...have.filter((h) => h.key.domain === undefined), { name: 'domain_1', key: { domain: 1 }, sparse: true }] });
  assert.equal(old.totals.conflicts, 1);
});

test('Sprint 8 (S8-B2, CO-115): the member model declares its three partial unique indexes and the user lookup, a fresh database misses all four, and once they exist nothing is missing', () => {
  const model = (dbSchemas as any).StoreMember ?? (dbSchemas as any).default?.StoreMember;
  const declared = model.schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'StoreMember', collection: 'storemembers', declared }], {});
  assert.deepEqual(fresh.toCreate, ['StoreMember']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean; partial: boolean }> }).missing;
  assert.equal(missing.length, 4);
  for (const name of ['store_user_unique', 'store_email_invited_unique', 'tokenHash_unique']) {
    assert.ok(missing.some((m) => m.name === name && m.unique && m.partial), name + ' is planned as a unique PARTIAL index');
  }
  assert.ok(missing.some((m) => m.name === 'user_status' && !m.unique));
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'StoreMember', collection: 'storemembers', declared }], { storemembers: [ID, ...have] }).totals.missing, 0);
  // A plain index on {store, email} is not the unique partial one: it is reported (missing or conflicting), never accepted.
  const plain = plan.planAll([{ model: 'StoreMember', collection: 'storemembers', declared }], { storemembers: [ID, { name: 'store_email_invited_unique', key: { store: 1, email: 1 } }] });
  assert.ok(plain.totals.missing + plain.totals.conflicts >= 1);
});

test('Sprint 8 (S8-B4, CO-115): the API key model declares the unique {prefix} and {store, revokedAt}; a fresh database misses both, and once they exist nothing is missing', () => {
  const model = (dbSchemas as any).ApiKey ?? (dbSchemas as any).default?.ApiKey;
  const declared = model.schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'ApiKey', collection: 'apikeys', declared }], {});
  assert.deepEqual(fresh.toCreate, ['ApiKey']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean }> }).missing;
  assert.equal(missing.length, 2);
  assert.ok(missing.some((m) => m.name === 'prefix_unique' && m.unique), 'the unique prefix is planned');
  assert.ok(missing.some((m) => m.name === 'store_revokedAt' && !m.unique));
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'ApiKey', collection: 'apikeys', declared }], { apikeys: [ID, ...have] }).totals.missing, 0);
  // A plain index on prefix is not the unique one.
  const plain = plan.planAll([{ model: 'ApiKey', collection: 'apikeys', declared }], { apikeys: [ID, { name: 'prefix_unique', key: { prefix: 1 } }] });
  assert.ok(plain.totals.missing + plain.totals.conflicts >= 1);
});

test('Sprint 8 (S8-B5, CO-115): the referral indexes: one code per seller (unique PARTIAL on users), one referral per referred seller (unique), and the referrer list', () => {
  const ns = (dbSchemas as any).User ? (dbSchemas as any) : (dbSchemas as any).default;
  const ID = { name: '_id_', key: { _id: 1 } };
  const named = (declared: Declared) =>
    declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  type Missing = Array<{ name: string; unique: boolean; partial: boolean }>;

  const userDeclared = ns.User.schema.indexes() as Declared;
  const freshUsers = plan.planAll([{ model: 'User', collection: 'users', declared: userDeclared }], {});
  const userMissing = (freshUsers.models[0] as unknown as { missing: Missing }).missing;
  assert.ok(userMissing.some((m) => m.name === 'referralCode_unique' && m.unique && m.partial), 'the code is a unique PARTIAL index');
  assert.equal(plan.planAll([{ model: 'User', collection: 'users', declared: userDeclared }], { users: [ID, ...named(userDeclared)] }).totals.missing, 0);

  const declared = ns.Referral.schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'Referral', collection: 'referrals', declared }], {});
  const missing = (fresh.models[0] as unknown as { missing: Missing }).missing;
  assert.ok(missing.some((m) => m.name === 'referred_1' && m.unique), 'one referral per referred seller');
  assert.ok(missing.some((m) => m.name === 'referrer_1' && !m.unique));
  assert.equal(plan.planAll([{ model: 'Referral', collection: 'referrals', declared }], { referrals: [ID, ...named(declared)] }).totals.missing, 0);
});

test('Sprint 8 (S8-B6, CO-115): the counter models, the referral reward slot and the referral credit: unique and TTL indexes are planned, and nothing is missing once they exist', () => {
  const ns = (dbSchemas as any).DailyStat ? (dbSchemas as any) : (dbSchemas as any).default;
  const ID = { name: '_id_', key: { _id: 1 } };
  const named = (declared: Declared) =>
    declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  type Missing = Array<{ name: string; unique: boolean; ttl: boolean; partial: boolean }>;
  const check = (model: string, collection: string, expected: Array<[string, Partial<Missing[number]>]>) => {
    const declared = ns[model].schema.indexes() as Declared;
    const fresh = plan.planAll([{ model, collection, declared }], {});
    assert.deepEqual(fresh.toCreate, [model]);
    assert.equal(fresh.totals.conflicts, 0);
    const missing = (fresh.models[0] as unknown as { missing: Missing }).missing;
    for (const [name, traits] of expected) {
      const found = missing.find((m) => m.name === name);
      assert.ok(found, model + ' plans ' + name);
      for (const [trait, value] of Object.entries(traits)) assert.equal((found as any)[trait], value, model + ' ' + name + ' ' + trait);
    }
    assert.equal(plan.planAll([{ model, collection, declared }], { [collection]: [ID, ...named(declared)] }).totals.missing, 0);
  };
  check('DailyStat', 'dailystats', [['store_day_unique', { unique: true }], ['expires_ttl', { ttl: true }], ['day', { unique: false }]]);
  check('ProductDailyStat', 'productdailystats', [['store_slug_day_unique', { unique: true }], ['expires_ttl', { ttl: true }], ['store_day', { unique: false }]]);
  check('Referral', 'referrals', [['referrer_month_slot_unique', { unique: true, partial: true }], ['status_createdAt', { unique: false }]]);
  check('SubscriptionCredit', 'subscriptioncredits', [['referral_unique', { unique: true }], ['seller_usedAt', { unique: false }]]);
});

test('Sprint 9 (EP-31.US01.T03): the phone model declares the unique {family}, {app, user, revokedAt} and the partial {revokedAt} and {pushToken}; a fresh database misses all four, and once they exist nothing is missing', () => {
  const model = (dbSchemas as any).MobileDevice ?? (dbSchemas as any).default?.MobileDevice;
  const declared = model.schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'MobileDevice', collection: 'mobiledevices', declared }], {});
  assert.deepEqual(fresh.toCreate, ['MobileDevice']);
  assert.equal(fresh.totals.conflicts, 0);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean; partial: boolean }> }).missing;
  assert.equal(missing.length, 4);
  assert.ok(missing.some((m) => m.name === 'pushToken_partial' && !m.unique && m.partial), 'only rows with a push token');
  assert.ok(missing.some((m) => m.name === 'family_unique' && m.unique), 'one row per token family');
  assert.ok(missing.some((m) => m.name === 'app_user_revokedAt' && !m.unique));
  assert.ok(missing.some((m) => m.name === 'revokedAt_partial' && !m.unique && m.partial));
  assert.equal(model.collection.name, 'mobiledevices');
  const ID = { name: '_id_', key: { _id: 1 } };
  const have = declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  assert.equal(plan.planAll([{ model: 'MobileDevice', collection: 'mobiledevices', declared }], { mobiledevices: [ID, ...have] }).totals.missing, 0);
  // A plain index on family is not the unique one.
  const plain = plan.planAll([{ model: 'MobileDevice', collection: 'mobiledevices', declared }], { mobiledevices: [ID, { name: 'family_unique', key: { family: 1 } }] });
  assert.ok(plain.totals.missing + plain.totals.conflicts >= 1);
});


test('Sprint 9 (EP-31.US01.T07): one second factor per admin: a fresh database misses the unique {user} index, and once it exists nothing is missing', () => {
  const model = (dbSchemas as any).AdminSecondFactor ?? (dbSchemas as any).default?.AdminSecondFactor;
  const declared = model.schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'AdminSecondFactor', collection: 'adminsecondfactors', declared }], {});
  assert.deepEqual(fresh.toCreate, ['AdminSecondFactor']);
  const missing = (fresh.models[0] as unknown as { missing: Array<{ name: string; unique: boolean }> }).missing;
  assert.deepEqual(missing.map((m) => [m.name, m.unique]), [['user_unique', true]]);
  assert.equal(model.collection.name, 'adminsecondfactors');
  const ID = { name: '_id_', key: { _id: 1 } };
  assert.equal(plan.planAll([{ model: 'AdminSecondFactor', collection: 'adminsecondfactors', declared }], { adminsecondfactors: [ID, { name: 'user_unique', key: { user: 1 }, unique: true }] }).totals.missing, 0);
});

test('Sprint 9 (EP-31.US03): the idempotency records have the unique {user, key} and the TTL, and orders have the two paging indexes', () => {
  const ns = (dbSchemas as any).IdempotencyRecord ? (dbSchemas as any) : (dbSchemas as any).default;
  const ID = { name: '_id_', key: { _id: 1 } };
  const named = (declared: Declared) =>
    declared.map(([key, options]) => ({ name: (options as { name?: string } | undefined)?.name ?? Object.entries(key).map(([k, d]) => k + '_' + d).join('_'), key, ...(options as object) }));
  type Missing = Array<{ name: string; unique: boolean; ttl: boolean }>;
  const records = ns.IdempotencyRecord.schema.indexes() as Declared;
  const fresh = plan.planAll([{ model: 'IdempotencyRecord', collection: 'idempotencyrecords', declared: records }], {});
  assert.deepEqual(fresh.toCreate, ['IdempotencyRecord']);
  const missing = (fresh.models[0] as unknown as { missing: Missing }).missing;
  assert.deepEqual(missing.map((m) => [m.name, m.unique, m.ttl]), [['user_key_unique', true, false], ['expires_ttl', false, true]]);
  assert.equal(plan.planAll([{ model: 'IdempotencyRecord', collection: 'idempotencyrecords', declared: records }], { idempotencyrecords: [ID, ...named(records)] }).totals.missing, 0);

  const orders = ns.Order.schema.indexes() as Declared;
  const orderMissing = (plan.planAll([{ model: 'Order', collection: 'orders', declared: orders }], {}).models[0] as unknown as { missing: Missing }).missing.map((m) => m.name);
  assert.ok(orderMissing.includes('store_createdAt_id'));
  assert.ok(orderMissing.includes('store_status_createdAt_id'));
});
