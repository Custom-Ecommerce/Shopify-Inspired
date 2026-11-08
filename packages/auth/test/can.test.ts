
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

test('order actions: system and the public are denied every action', () => {
for (const actor of ['system', 'public'] as const) {
for (const action of ORDER_ACTION_NAMES) {
assert.equal(orderCan(actor, action), false, actor + ' ' + action);
}
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
for (const actor of ['admin', 'system', 'public'] as const) {
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
