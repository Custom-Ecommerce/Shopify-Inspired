
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCan, can, PolicyConfigError, PolicyDeniedError } from '../src/can';
import { ORDER_ACTIONS, POLICY_MATRIX, type Actor } from '../src/policy';

test('products: a seller may read, create, update and delete; the fields are allowlisted', () => {
assert.equal(can('seller', 'read', 'products'), true);
assert.equal(can('seller', 'create', 'products', ['title', 'variants', 'categories']), true);
assert.equal(can('seller', 'update', 'products', ['title', 'variants']), true);
assert.equal(can('seller', 'delete', 'products'), true);
});

test('products: a seller may not write the store, the status, the demo flag or a derived field', () => {
for (const field of ['store', 'isPublished', 'isDemo', 'minPrice', 'avgRating', 'reviewCount', 'viewCount']) {
assert.equal(can('seller', 'create', 'products', [field]), false, field);
assert.equal(can('seller', 'update', 'products', ['title', field]), false, field);
}
});

test('products: an admin only reads, and system has no rows', () => {
assert.equal(can('admin', 'read', 'products'), true);
for (const operation of ['create', 'update', 'delete'] as const) {
assert.equal(can('admin', operation, 'products', ['title']), false, operation);
assert.equal(can('system', operation, 'products', ['title']), false, operation);
}
assert.equal(can('system', 'read', 'products'), false);
});

test('products: the public reads listed fields only and writes nothing', () => {
assert.equal(can('public', 'read', 'products', ['title', 'variants', 'minPrice']), true);
assert.equal(can('public', 'read', 'products'), false);
assert.equal(can('public', 'read', 'products', ['store']), false);
assert.equal(can('public', 'read', 'products', ['isDemo']), false);
for (const operation of ['create', 'update', 'delete'] as const) {
assert.equal(can('public', operation, 'products', ['title']), false, operation);
}
});

test('products: videos are a seller field and a public read', () => {
assert.equal(can('seller', 'create', 'products', ['videos']), true);
assert.equal(can('seller', 'update', 'products', ['videos']), true);
assert.equal(can('public', 'read', 'products', ['videos']), true);
assert.equal(can('admin', 'update', 'products', ['videos']), false);
});

test('productBulk: only a seller imports and exports', () => {
assert.equal(can('seller', 'read', 'productBulk'), true);
assert.equal(can('seller', 'create', 'productBulk'), true);
for (const actor of ['admin', 'system', 'public'] as const) {
assert.equal(can(actor, 'read', 'productBulk'), false, actor);
assert.equal(can(actor, 'create', 'productBulk'), false, actor);
}
assert.equal(can('seller', 'update', 'productBulk'), false);
assert.equal(can('seller', 'delete', 'productBulk'), false);
});

test('productModeration: only an admin, and an admin still cannot create or edit a product (D-002)', () => {
for (const operation of ['read', 'update', 'delete'] as const) {
assert.equal(can('admin', operation, 'productModeration'), true, operation);
for (const actor of ['seller', 'system', 'public'] as const) {
assert.equal(can(actor, operation, 'productModeration'), false, actor + ' ' + operation);
}
}
assert.equal(can('admin', 'create', 'productModeration'), false);
assert.equal(can('admin', 'update', 'products', ['title']), false);
assert.equal(can('admin', 'create', 'products', ['title']), false);
});

test('storePreview: only a seller may ask for a preview link, and nothing else can be done to one (D-042)', () => {
assert.equal(can('seller', 'create', 'storePreview'), true);
for (const actor of ['admin', 'system', 'public'] as const) {
assert.equal(can(actor, 'create', 'storePreview'), false, actor);
}
for (const operation of ['read', 'update', 'delete'] as const) {
assert.equal(can('seller', operation, 'storePreview'), false, operation);
}
});

test('seller update with no field list is denied (fail-closed)', () => {
assert.equal(can('seller', 'update', 'stores'), false);
});

test('seller update with an empty field list is denied', () => {
assert.equal(can('seller', 'update', 'stores', []), false);
});

test('seller may write an operations field', () => {
assert.equal(can('seller', 'update', 'stores', ['storefront']), true);
});

test('seller may write a nested path under an allowed field', () => {
assert.equal(can('seller', 'update', 'stores', ['storefront.heroBanners']), true);
});

test('seller may not write commissionRate or owner', () => {
assert.equal(can('seller', 'update', 'stores', ['commissionRate']), false);
assert.equal(can('seller', 'update', 'stores', ['owner']), false);
});

test('a lookalike prefix does not grant access', () => {
assert.equal(can('seller', 'update', 'stores', ['storefrontEvil']), false);
});

test('one disallowed field in a mixed request denies the whole request', () => {
assert.equal(can('seller', 'update', 'stores', ['storefront', 'owner']), false);
});

test('anonymous read without a field list is denied', () => {
assert.equal(can('public', 'read', 'stores'), false);
});

test('anonymous read of billing identifiers is denied', () => {
assert.equal(can('public', 'read', 'stores', ['stripeConnectedAccountId']), false);
});

test('anonymous read of storefront fields is allowed', () => {
assert.equal(can('public', 'read', 'stores', ['storefront']), true);
});

test('seller may not create sync-outbox rows; system may', () => {
assert.equal(can('seller', 'create', 'sync-outbox'), false);
assert.equal(can('system', 'create', 'sync-outbox'), true);
});

test('admin may not write passwordHash through a generic update', () => {
assert.equal(can('admin', 'update', 'users', ['passwordHash']), false);
});

test('admin may not change the platform settings revision', () => {
assert.equal(can('admin', 'update', 'platformSettings', ['settingsRevision']), false);
assert.equal(can('admin', 'update', 'platformSettings', ['defaultCommissionRate']), true);
});

test('Sprint 6: admin may write the COD commission percent and the plan settings; a seller and the public may not', () => {
const fields = ['codCommissionPercent', 'paymentInstructions', 'graceDays', 'trialDays', 'supportEmail', 'supportPhone'];
for (const field of fields) {
assert.equal(can('admin', 'update', 'platformSettings', [field]), true, field);
assert.equal(can('system', 'update', 'platformSettings', [field]), true, field);
assert.equal(can('seller', 'update', 'platformSettings', [field]), false, field);
assert.equal(can('public', 'update', 'platformSettings', [field]), false, field);
}
assert.equal(can('admin', 'update', 'platformSettings', ['codCommissionPercent', 'settingsRevision']), false);
});

test('Sprint 6: only an admin (and the system) may write storeLimitOverride; a seller, the public and a generic users update may not', () => {
assert.equal(can('admin', 'update', 'sellers', ['storeLimitOverride']), true);
assert.equal(can('system', 'update', 'sellers', ['storeLimitOverride']), true);
assert.equal(can('seller', 'update', 'sellers', ['storeLimitOverride']), false);
assert.equal(can('public', 'update', 'sellers', ['storeLimitOverride']), false);
assert.equal(can('seller', 'update', 'users', ['storeLimitOverride']), false);
assert.equal(can('public', 'update', 'users', ['storeLimitOverride']), false);
assert.equal(can('admin', 'update', 'users', ['storeLimitOverride']), false);
assert.equal(can('admin', 'read', 'users', ['storeLimitOverride']), true);
assert.equal(can('seller', 'read', 'users', ['storeLimitOverride']), false);
});

test('audit entries are immutable, even for system', () => {
assert.equal(can('system', 'update', 'audit-log', ['x']), false);
assert.equal(can('system', 'delete', 'audit-log'), false);
});

test('admin may read ledger totals but not order identifiers', () => {
assert.equal(can('admin', 'read', 'commissionLedger', ['orderAmount']), true);
assert.equal(can('admin', 'read', 'commissionLedger', ['orderId']), false);
});

test('undeclared collection throws PolicyConfigError instead of allowing', () => {
assert.throws(() => can('admin', 'read', 'commissionLedgerView'), PolicyConfigError);
});

test('there is one categories declaration, and it is fail-closed for unknown actors', () => {
assert.deepEqual([...POLICY_MATRIX.categories.read.actors].sort(), ['admin', 'public', 'seller']);
assert.deepEqual([...POLICY_MATRIX.categories.create.actors], ['seller']);
assert.deepEqual([...POLICY_MATRIX.categories.update.actors], ['seller']);
assert.deepEqual([...POLICY_MATRIX.categories.delete.actors], ['seller']);
});

test('a seller may read, create, update, and delete categories', () => {
assert.equal(can('seller', 'read', 'categories'), true);
assert.equal(can('seller', 'create', 'categories', ['name', 'slug', 'order', 'description']), true);
assert.equal(can('seller', 'update', 'categories', ['name']), true);
assert.equal(can('seller', 'delete', 'categories'), true);
});

test('a seller may not set the store, isDemo, or banner of a category', () => {
for (const field of ['store', 'isDemo', 'banner']) {
assert.equal(can('seller', 'create', 'categories', ['name', field]), false, field);
assert.equal(can('seller', 'update', 'categories', [field]), false, field);
}
});

test('a category write with no field list is denied (fail-closed)', () => {
assert.equal(can('seller', 'create', 'categories'), false);
assert.equal(can('seller', 'update', 'categories'), false);
});

test('admin may read categories and nothing else', () => {
assert.equal(can('admin', 'read', 'categories'), true);
assert.equal(can('admin', 'create', 'categories', ['name']), false);
assert.equal(can('admin', 'update', 'categories', ['name']), false);
assert.equal(can('admin', 'delete', 'categories'), false);
});

test('public may read only the public category fields, and may not write', () => {
assert.equal(can('public', 'read', 'categories', ['name', 'slug', 'order', 'description', 'banner']), true);
assert.equal(can('public', 'read', 'categories'), false);
assert.equal(can('public', 'read', 'categories', ['store']), false);
assert.equal(can('public', 'read', 'categories', ['isDemo']), false);
assert.equal(can('public', 'create', 'categories', ['name']), false);
assert.equal(can('public', 'delete', 'categories'), false);
});

test('system has no category access', () => {
assert.equal(can('system', 'read', 'categories'), false);
assert.equal(can('system', 'create', 'categories', ['name']), false);
assert.equal(can('system', 'update', 'categories', ['name']), false);
assert.equal(can('system', 'delete', 'categories'), false);
});

test('productLifecycle: a seller publishes, restores and deletes; nobody else writes, and a PATCH still cannot publish', () => {
assert.equal(can('seller', 'update', 'productLifecycle', ['isPublished']), true);
assert.equal(can('seller', 'update', 'productLifecycle', ['deletedAt']), true);
assert.equal(can('seller', 'update', 'productLifecycle', ['isDemo']), false);
assert.equal(can('seller', 'update', 'productLifecycle'), false);
assert.equal(can('seller', 'delete', 'productLifecycle'), true);
assert.equal(can('system', 'delete', 'productLifecycle'), true);
for (const actor of ['admin', 'public'] as const) {
assert.equal(can(actor, 'update', 'productLifecycle', ['isPublished']), false, actor);
assert.equal(can(actor, 'delete', 'productLifecycle'), false, actor);
}
assert.equal(can('seller', 'update', 'products', ['isPublished']), false);
assert.equal(can('seller', 'update', 'products', ['hideWhenOutOfStock']), true);
});

test('inventory: a seller reads and adjusts stock only; movements are never created or removed by hand', () => {
assert.equal(can('seller', 'read', 'inventory'), true);
assert.equal(can('seller', 'update', 'inventory', ['stockQuantity']), true);
assert.equal(can('seller', 'update', 'inventory', ['price']), false);
assert.equal(can('seller', 'create', 'inventory', ['stockQuantity']), false);
assert.equal(can('seller', 'delete', 'inventory'), false);
assert.equal(can('public', 'read', 'inventory'), false);
assert.equal(can('admin', 'update', 'inventory', ['stockQuantity']), false);
});

test('archivedReviews: only system writes, once; no actor updates or deletes', () => {
assert.equal(can('system', 'create', 'archivedReviews'), true);
assert.equal(can('seller', 'read', 'archivedReviews'), false);
assert.equal(can('seller', 'create', 'archivedReviews'), false);
for (const actor of ['admin', 'seller', 'system', 'public'] as const) {
assert.equal(can(actor, 'update', 'archivedReviews', ['body']), false, actor);
assert.equal(can(actor, 'delete', 'archivedReviews'), false, actor);
}
});

// EP-02 OB-1a: order actions.

const ORDER_ACTION_NAMES = ['view', 'transition', 'cancel', 'note', 'payment', 'print', 'tracking'] as const;
const ORDER_ROWS = ['orderView', 'orderTransition', 'orderCancel', 'orderNotes', 'orderPayment', 'orderPrint', 'orderTracking'] as const;

/** The fields a seller would send for each action; read actions send none. */
const ORDER_ACTION_FIELDS: Record<(typeof ORDER_ACTION_NAMES)[number], readonly string[] | undefined> = {
view: undefined,
transition: ['status', 'note', 'courier', 'trackingNumber', 'trackingUrl'],
cancel: ['reason', 'note'],
note: ['text'],
payment: ['amount'],
print: undefined,
tracking: ['courier', 'trackingNumber', 'trackingUrl'],
};

const orderCan = (actor: string, action: (typeof ORDER_ACTION_NAMES)[number], fields = ORDER_ACTION_FIELDS[action]) =>
can(actor as Actor, ORDER_ACTIONS[action].operation, ORDER_ACTIONS[action].collection, fields);

test('order actions: every action maps to a declared row', () => {
assert.deepEqual(Object.keys(ORDER_ACTIONS), [...ORDER_ACTION_NAMES]);
for (const name of ORDER_ACTION_NAMES) {
assert.ok(ORDER_ACTIONS[name].collection in POLICY_MATRIX, name);
}
assert.deepEqual(ORDER_ACTION_NAMES.map((name) => ORDER_ACTIONS[name].collection), [...ORDER_ROWS]);
});

test('order actions: the store owner may view, transition, cancel, note, pay and print', () => {
for (const action of ORDER_ACTION_NAMES) {
assert.equal(orderCan('seller', action), true, action);
}
assert.equal(can('seller', 'read', 'orderNotes'), true);
});

test('order actions: admin is denied every action in this epic (fail-closed)', () => {
for (const action of ORDER_ACTION_NAMES) {
assert.equal(orderCan('admin', action), false, action);
}
});

test('order actions: the public is denied every action, and system all but a Stripe cancel (D-082)', () => {
for (const action of ORDER_ACTION_NAMES) {
assert.equal(orderCan('public', action), false, 'public ' + action);
if (action !== 'cancel') assert.equal(orderCan('system', action), false, 'system ' + action);
}
});

test('order actions: an unknown role is denied every action, including a future staff role not yet declared', () => {
for (const role of ['staff', 'store_staff', 'owner', '', 'SELLER']) {
for (const action of ORDER_ACTION_NAMES) {
assert.equal(orderCan(role, action), false, role + ' ' + action);
}
}
});

test('order actions: every operation a row does not declare is denied, for every actor', () => {
for (const row of ORDER_ROWS) {
for (const operation of ['read', 'create', 'update', 'delete'] as const) {
const declared = POLICY_MATRIX[row][operation].actors.length > 0;
if (declared) continue;
for (const actor of ['seller', 'admin', 'system', 'public'] as const) {
assert.equal(can(actor, operation, row, ['status']), false, row + ' ' + operation + ' ' + actor);
}
}
}
assert.equal(can('seller', 'delete', 'orderNotes'), false);
assert.equal(can('seller', 'update', 'orderNotes', ['text']), false);
assert.equal(can('seller', 'delete', 'orderView'), false);
});

test('order write actions with no field list are denied (fail-closed)', () => {
for (const action of ['transition', 'cancel', 'note', 'payment'] as const) {
const { operation, collection } = ORDER_ACTIONS[action];
assert.equal(can('seller', operation, collection), false, action);
assert.equal(can('seller', operation, collection, []), false, action);
}
});

test('order write actions refuse fields outside their own list', () => {
for (const field of ['store', 'total', 'items', 'statusHistory', 'notes', 'phone', 'cancelledAt', 'collectedAt']) {
assert.equal(orderCan('seller', 'transition', ['status', field]), false, 'transition ' + field);
assert.equal(orderCan('seller', 'cancel', ['reason', field]), false, 'cancel ' + field);
assert.equal(orderCan('seller', 'note', ['text', field]), false, 'note ' + field);
assert.equal(orderCan('seller', 'payment', ['amount', field]), false, 'payment ' + field);
}
// One action cannot do another's job.
assert.equal(orderCan('seller', 'transition', ['paymentStatus']), false);
assert.equal(orderCan('seller', 'payment', ['status']), false);
assert.equal(orderCan('seller', 'cancel', ['status']), false);
assert.equal(orderCan('seller', 'transition', ['cancelReason']), false);
});

test('assertCan throws for a denied order action', () => {
assert.throws(
() => assertCan('admin', ORDER_ACTIONS.cancel.operation, ORDER_ACTIONS.cancel.collection, ['reason']),
PolicyDeniedError,
);
assert.doesNotThrow(() => assertCan('seller', ORDER_ACTIONS.view.operation, ORDER_ACTIONS.view.collection));
});

test('the B10.4 orders row is unchanged by EP-02', () => {
assert.deepEqual([...POLICY_MATRIX.orders.read.actors], ['admin', 'system', 'seller']);
assert.deepEqual([...POLICY_MATRIX.orders.create.actors], ['system']);
assert.deepEqual([...POLICY_MATRIX.orders.update.actors], ['admin', 'system']);
assert.deepEqual([...POLICY_MATRIX.orders.delete.actors], ['admin', 'system']);
assert.equal(can('seller', 'update', 'orders', ['status']), false);
});

test('orderTransition (OB-2): the history note is a transition field, and only there and on cancel', () => {
assert.equal(can('seller', 'update', 'orderTransition', ['status', 'note']), true);
assert.equal(can('seller', 'update', 'orderTransition', ['note']), true);
assert.deepEqual([...(POLICY_MATRIX.orderTransition.update.fields as Record<string, readonly string[]>).seller], [
'status', 'note', 'courier', 'trackingNumber', 'trackingUrl',
]);
assert.equal(can('admin', 'update', 'orderTransition', ['status', 'note']), false);
assert.equal(can('seller', 'update', 'orderPayment', ['amount', 'note']), false);
assert.equal(can('seller', 'update', 'orderCancel', ['reason', 'note']), true);
assert.equal(can('seller', 'update', 'orderTransition', ['status', 'statusHistory']), false);
});

test('orderCancel (OB-3): the seller sends reason and an optional note; the stored fields stay server-owned', () => {
assert.deepEqual([...(POLICY_MATRIX.orderCancel.update.fields as Record<string, readonly string[]>).seller], ['reason', 'note']);
assert.equal(can('seller', 'update', 'orderCancel', ['reason']), true);
assert.equal(can('seller', 'update', 'orderCancel', ['reason', 'note']), true);
for (const field of ['cancelReason', 'cancelledAt', 'status', 'stockRestoredAt', 'statusHistory', 'items']) {
assert.equal(can('seller', 'update', 'orderCancel', ['reason', field]), false, field);
}
for (const actor of ['admin', 'public'] as const) {
assert.equal(can(actor, 'update', 'orderCancel', ['reason']), false, actor);
}
assert.equal(can('seller', 'update', 'orderCancel'), false);
});

test('orderTracking (OB-4): the seller edits courier, tracking number and link only; everyone else is denied', () => {
assert.deepEqual(ORDER_ACTIONS.tracking, { operation: 'update', collection: 'orderTracking' });
assert.equal(can('seller', 'update', 'orderTracking', ['courier', 'trackingNumber', 'trackingUrl']), true);
assert.equal(can('seller', 'update', 'orderTracking', ['trackingUrl']), true);
for (const field of ['status', 'note', 'statusHistory', 'store', 'cancelReason']) {
assert.equal(can('seller', 'update', 'orderTracking', ['courier', field]), false, field);
}
for (const actor of ['admin', 'system', 'public'] as const) {
assert.equal(can(actor, 'update', 'orderTracking', ['courier']), false, actor);
}
for (const operation of ['read', 'create', 'delete'] as const) {
assert.equal(can('seller', operation, 'orderTracking', ['courier']), false, operation);
}
assert.equal(can('seller', 'update', 'orderTracking'), false);
});

test('orderPayment and orderNotes (OB-5a): the request keys only; the stored fields stay server-owned; admin denied', () => {
assert.deepEqual([...(POLICY_MATRIX.orderPayment.update.fields as Record<string, readonly string[]>).seller], ['amount']);
assert.equal(can('seller', 'update', 'orderPayment', ['amount']), true);
for (const field of ['paymentStatus', 'collectedAmount', 'collectedAt', 'status', 'statusHistory']) {
assert.equal(can('seller', 'update', 'orderPayment', [field]), false, field);
}
assert.deepEqual([...(POLICY_MATRIX.orderNotes.create.fields as Record<string, readonly string[]>).seller], ['text']);
assert.equal(can('seller', 'create', 'orderNotes', ['text']), true);
for (const field of ['by', 'at', 'notes']) {
assert.equal(can('seller', 'create', 'orderNotes', ['text', field]), false, field);
}
for (const actor of ['admin', 'system', 'public'] as const) {
assert.equal(can(actor, 'update', 'orderPayment', ['amount']), false, actor);
assert.equal(can(actor, 'create', 'orderNotes', ['text']), false, actor);
}
// An empty field list is denied, so the route must not run the field check when no amount was sent.
assert.equal(can('seller', 'update', 'orderPayment', []), false);
});

test('orderPrint (OB-5b): only the seller reads print data; nothing can be written through it', () => {
assert.deepEqual(ORDER_ACTIONS.print, { operation: 'read', collection: 'orderPrint' });
assert.equal(can('seller', 'read', 'orderPrint'), true);
for (const actor of ['admin', 'system', 'public'] as const) {
assert.equal(can(actor, 'read', 'orderPrint'), false, actor);
}
for (const operation of ['create', 'update', 'delete'] as const) {
assert.equal(can('seller', operation, 'orderPrint', ['status']), false, operation);
}
});

test('D-082: a Stripe event acts as system, and may only cancel with a reason or mark a card order paid', () => {
assert.equal(can('system', 'update', 'orderCancel', ['reason']), true);
assert.equal(can('system', 'update', 'orderCancel', ['reason', 'note']), true);
assert.equal(can('system', 'update', 'orderCancel', ['status']), false);
assert.equal(can('system', 'update', 'orderPayment', ['paymentStatus', 'paidAt']), true);
assert.equal(can('system', 'update', 'orderPayment', ['amount']), false);
assert.equal(can('seller', 'update', 'orderPayment', ['paymentStatus']), false);
assert.equal(can('seller', 'update', 'orderPayment', ['paidAt']), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-14 (D-118): the subscriptionPlans policy row, for every actor.

test('Sprint 6 plans: an admin reads everything, creates with the key, and updates without it', () => {
assert.equal(can('admin', 'read', 'subscriptionPlans'), true);
assert.equal(can('admin', 'read', 'subscriptionPlans', ['stripePriceId', 'revision']), true);
assert.equal(can('admin', 'create', 'subscriptionPlans', ['key', 'name', 'priceRs', 'limits', 'features', 'sortOrder', 'stripePriceId']), true);
assert.equal(can('admin', 'update', 'subscriptionPlans', ['name', 'priceRs', 'limits', 'features', 'sortOrder', 'stripePriceId', 'isActive', 'archivedAt']), true);
assert.equal(can('admin', 'update', 'subscriptionPlans', ['key']), false, 'the key never changes');
assert.equal(can('admin', 'update', 'subscriptionPlans', ['revision']), false, 'only the server moves the revision');
assert.equal(can('admin', 'create', 'subscriptionPlans', ['revision']), false);
});

test('Sprint 6 plans: the system may do everything the server needs, including moving the revision', () => {
assert.equal(can('system', 'read', 'subscriptionPlans'), true);
assert.equal(can('system', 'create', 'subscriptionPlans', ['key', 'revision']), true);
assert.equal(can('system', 'update', 'subscriptionPlans', ['revision', 'name']), true);
});

test('Sprint 6 plans: a seller and the public read only the public view', () => {
for (const actor of ['seller', 'public'] as const) {
assert.equal(can(actor, 'read', 'subscriptionPlans', ['key', 'name', 'priceRs', 'interval', 'limits', 'features', 'sortOrder', 'isActive']), true, actor);
for (const hidden of ['stripePriceId', 'revision', 'archivedAt', 'tier', 'createdAt']) assert.equal(can(actor, 'read', 'subscriptionPlans', [hidden]), false, actor + ' ' + hidden);
}
});

test('Sprint 6 plans: a seller and the public cannot create or update a plan', () => {
for (const actor of ['seller', 'public'] as const) {
assert.equal(can(actor, 'create', 'subscriptionPlans', ['key', 'name']), false, actor);
assert.equal(can(actor, 'update', 'subscriptionPlans', ['name']), false, actor);
assert.equal(can(actor, 'update', 'subscriptionPlans', ['isActive']), false, actor + ' cannot archive');
}
});

test('Sprint 6 plans: nobody deletes a plan, system and admin included: archiving is the only removal', () => {
for (const actor of ['admin', 'system', 'seller', 'public'] as const) assert.equal(can(actor, 'delete', 'subscriptionPlans'), false, actor);
assert.deepEqual(POLICY_MATRIX.subscriptionPlans!.delete.actors, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-14 (D-118): the subscriptions policy row, for every actor.

test('Sprint 6 subscriptions: an admin reads everything, creates with the seller, and updates without the seller or the revision', () => {
assert.equal(can('admin', 'read', 'subscriptions'), true);
assert.equal(can('admin', 'read', 'subscriptions', ['revision', 'seller']), true);
assert.equal(can('admin', 'create', 'subscriptions', ['seller', 'planKey', 'status', 'currentPeriodEnd', 'source']), true);
assert.equal(can('admin', 'update', 'subscriptions', ['planKey', 'status', 'periodStart', 'currentPeriodEnd', 'graceUntil', 'trialEndsAt', 'source', 'cancelAtPeriodEnd']), true);
assert.equal(can('admin', 'update', 'subscriptions', ['seller']), false, 'one subscription per seller: it never moves');
assert.equal(can('admin', 'update', 'subscriptions', ['revision']), false, 'only the server moves the revision');
assert.equal(can('admin', 'create', 'subscriptions', ['revision']), false);
});

test('Sprint 6 subscriptions: the system may do what the expiry job needs, including the revision', () => {
assert.equal(can('system', 'read', 'subscriptions'), true);
assert.equal(can('system', 'create', 'subscriptions', ['seller', 'revision']), true);
assert.equal(can('system', 'update', 'subscriptions', ['status', 'graceUntil', 'revision']), true);
});

test('Sprint 6 subscriptions: a seller reads the subscription fields (their own, by the route) and nothing else', () => {
assert.equal(can('seller', 'read', 'subscriptions', ['planKey', 'status', 'currentPeriodEnd', 'graceUntil', 'trialEndsAt', 'cancelAtPeriodEnd', 'source', 'periodStart']), true);
for (const hidden of ['seller', 'revision', 'createdAt', 'updatedAt']) assert.equal(can('seller', 'read', 'subscriptions', [hidden]), false, hidden);
});

test('Sprint 6 subscriptions: a seller cannot create or update a subscription, so cannot give themselves a plan', () => {
assert.equal(can('seller', 'create', 'subscriptions', ['planKey']), false);
for (const field of ['planKey', 'status', 'currentPeriodEnd', 'graceUntil', 'trialEndsAt', 'cancelAtPeriodEnd']) assert.equal(can('seller', 'update', 'subscriptions', [field]), false, field);
});

test('Sprint 6 subscriptions: the public reads, creates and updates nothing', () => {
for (const op of ['read', 'create', 'update', 'delete'] as const) assert.equal(can('public', op, 'subscriptions'), false, op);
});

test('Sprint 6 subscriptions: nobody deletes a subscription, admin and system included', () => {
for (const actor of ['admin', 'system', 'seller', 'public'] as const) assert.equal(can(actor, 'delete', 'subscriptions'), false, actor);
assert.deepEqual(POLICY_MATRIX.subscriptions!.delete.actors, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 (S6-B4, D-118): the subscriptionPayments policy row, for every actor.

test('Sprint 6 payments: a seller reads the money facts of their payment and not the admin\'s bookkeeping', () => {
assert.equal(can('seller', 'read', 'subscriptionPayments', ['planKey', 'amountRs', 'status', 'method', 'reference', 'proofUrl', 'periodStart', 'periodEnd', 'reason', 'claimedAt', 'decidedAt']), true);
for (const hidden of ['seller', 'decidedBy', 'revision', 'subscriptionBefore', 'subscriptionRevisionAfter', 'isOpen']) assert.equal(can('seller', 'read', 'subscriptionPayments', [hidden]), false, hidden);
});

test('Sprint 6 payments: a seller creates with the plan key only: the amount, the status and the period are never theirs', () => {
assert.equal(can('seller', 'create', 'subscriptionPayments', ['planKey']), true);
for (const field of ['amountRs', 'status', 'periodStart', 'periodEnd', 'seller', 'decidedBy', 'method']) assert.equal(can('seller', 'create', 'subscriptionPayments', [field]), false, field);
});

test('Sprint 6 payments: a seller can say I paid (method, reference, proof, claimed) and cannot confirm, change the amount or the period', () => {
assert.equal(can('seller', 'update', 'subscriptionPayments', ['method', 'reference', 'proofUrl', 'status', 'claimedAt']), true);
for (const field of ['amountRs', 'planKey', 'periodStart', 'periodEnd', 'decidedBy', 'decidedAt', 'reason', 'seller']) assert.equal(can('seller', 'update', 'subscriptionPayments', [field]), false, field);
});

test('Sprint 6 payments: an admin reads everything and updates the status fields only; an admin never creates a payment', () => {
assert.equal(can('admin', 'read', 'subscriptionPayments'), true);
assert.equal(can('admin', 'read', 'subscriptionPayments', ['decidedBy', 'revision', 'seller']), true);
assert.equal(can('admin', 'update', 'subscriptionPayments', ['status', 'decidedBy', 'decidedAt', 'reason', 'periodStart', 'periodEnd']), true);
for (const field of ['amountRs', 'planKey', 'seller', 'method', 'reference', 'revision']) assert.equal(can('admin', 'update', 'subscriptionPayments', [field]), false, field);
assert.equal(can('admin', 'create', 'subscriptionPayments', ['planKey']), false);
});

test('Sprint 6 payments: the system does what the server needs', () => {
assert.equal(can('system', 'read', 'subscriptionPayments'), true);
assert.equal(can('system', 'create', 'subscriptionPayments', ['seller', 'planKey', 'amountRs']), true);
assert.equal(can('system', 'update', 'subscriptionPayments', ['revision', 'isOpen', 'status']), true);
});

test('Sprint 6 payments: the public reads, creates and updates nothing', () => {
for (const op of ['read', 'create', 'update', 'delete'] as const) assert.equal(can('public', op, 'subscriptionPayments'), false, op);
});

test('Sprint 6 payments: nobody deletes a payment, admin and system included', () => {
for (const actor of ['admin', 'system', 'seller', 'public'] as const) assert.equal(can(actor, 'delete', 'subscriptionPayments'), false, actor);
assert.deepEqual(POLICY_MATRIX.subscriptionPayments!.delete.actors, []);
});

test('Sprint 6 (S6-B4) subscriptions: a seller reads the pending plan of their own subscription, and still cannot write it (the route does, after their request)', () => {
assert.equal(can('seller', 'read', 'subscriptions', ['pendingPlanKey']), true);
assert.equal(can('seller', 'update', 'subscriptions', ['pendingPlanKey']), false);
assert.equal(can('seller', 'update', 'subscriptions', ['cancelAtPeriodEnd']), false);
assert.equal(can('public', 'read', 'subscriptions', ['pendingPlanKey']), false);
});

test('S6-B5 adminOrdersView: an admin and the system read the safe fields only, and never the shopper name, phone, address or email', () => {
for (const actor of ['admin', 'system'] as const) {
assert.equal(can(actor, 'read', 'adminOrdersView', ['orderNumber', 'status', 'total', 'city', 'items', 'totals', 'statusHistory']), true, actor);
for (const hidden of ['phone', 'phoneKey', 'address', 'customerName', 'customerEmail', 'customerNote', 'customerWhatsapp', 'notes']) assert.equal(can(actor, 'read', 'adminOrdersView', [hidden]), false, actor + ' ' + hidden);
}
});

test('S6-B5 adminOrdersView: a seller and the public read nothing through it, and nobody writes or deletes', () => {
for (const actor of ['seller', 'public'] as const) assert.equal(can(actor, 'read', 'adminOrdersView', ['status']), false, actor);
for (const actor of ['admin', 'system', 'seller', 'public'] as const) for (const op of ['create', 'update', 'delete'] as const) assert.equal(can(actor, op, 'adminOrdersView'), false, actor + ' ' + op);
});

test('S6-B6: an admin can no longer write role, create a user with a role, or touch adminLevel through the generic users row', () => {
assert.equal(can('admin', 'update', 'users', ['role']), false);
assert.equal(can('admin', 'create', 'users', ['role']), false);
assert.equal(can('admin', 'update', 'users', ['adminLevel']), false);
assert.equal(can('admin', 'update', 'users', ['name']), true);
assert.equal(can('admin', 'read', 'users', ['adminLevel']), true);
for (const actor of ['seller', 'public'] as const) {
assert.equal(can(actor, 'update', 'users', ['role']), false, actor);
assert.equal(can(actor, 'update', 'users', ['adminLevel']), false, actor);
}
});

test('S6-B6 adminUsers: an admin (the routes then require owner level) invites, changes the level and disables; nobody changes a password hash or deletes', () => {
assert.equal(can('admin', 'read', 'adminUsers', ['name', 'email', 'adminLevel', 'accountStatus']), true);
assert.equal(can('admin', 'create', 'adminUsers', ['name', 'email', 'adminLevel']), true);
assert.equal(can('admin', 'update', 'adminUsers', ['adminLevel', 'accountStatus', 'suspensionReason']), true);
for (const hidden of ['passwordHash', 'role', 'tokenVersion', 'storeLimitOverride']) {
assert.equal(can('admin', 'update', 'adminUsers', [hidden]), false, hidden);
assert.equal(can('admin', 'create', 'adminUsers', [hidden]), false, hidden);
}
assert.equal(can('admin', 'read', 'adminUsers', ['passwordHash']), false);
for (const actor of ['admin', 'system', 'seller', 'public'] as const) assert.equal(can(actor, 'delete', 'adminUsers'), false, actor);
});

test('S6-B6 adminUsers: a seller and the public read, create and update nothing', () => {
for (const actor of ['seller', 'public'] as const) for (const op of ['read', 'create', 'update'] as const) assert.equal(can(actor, op, 'adminUsers'), false, actor + ' ' + op);
});
