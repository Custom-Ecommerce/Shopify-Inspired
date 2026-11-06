
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, PolicyConfigError } from '../src/can';
import { POLICY_MATRIX } from '../src/policy';

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
