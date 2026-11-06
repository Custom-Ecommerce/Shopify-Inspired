
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, User, SyncOutbox } from '../src';

// These tests validate documents in memory. No database connection is needed.

function store(overrides: Record<string, unknown> = {}) {
return new Store({ name: 'Acme', slug: 'acme', ...overrides });
}

test('store accepts the archived status added in Phase 1', () => {
assert.equal(store({ status: 'archived' }).validateSync(), undefined);
});

test('store rejects an unknown status', () => {
assert.notEqual(store({ status: 'bogus' }).validateSync(), undefined);
});

test('store requires a name', () => {
assert.notEqual(new Store({ slug: 'acme' }).validateSync(), undefined);
});

test('store defaults match Payload: pending status, zero commission, inherit mode, zero revisions', () => {
const doc = store();
assert.equal(doc.status, 'pending');
assert.equal(doc.commissionRate, 0);
assert.equal(doc.commissionMode, 'inherit');
assert.equal(doc.govRevision, 0);
assert.equal(doc.opsRevision, 0);
});

test('store rejects a custom domain status outside the Payload set', () => {
assert.notEqual(store({ customDomainStatus: 'maybe' }).validateSync(), undefined);
});

test('store owner references the User collection', () => {
assert.equal(Store.schema.path('owner').options.ref, 'User');
});

test('user defaults to the seller role and never selects the password hash', () => {
const doc = new User({ name: 'Ali', email: 'ali@example.com', passwordHash: 'h' });
assert.equal(doc.role, 'seller');
assert.equal(User.schema.path('passwordHash').options.select, false);
});

test('user rejects a role outside admin and seller', () => {
const doc = new User({ name: 'Ali', email: 'ali@example.com', passwordHash: 'h', role: 'superuser' });
assert.notEqual(doc.validateSync(), undefined);
});

test('sync outbox accepts a complete envelope', () => {
const doc = new SyncOutbox({
eventId: 'evt-1',
target: 'admin',
entity: 'store',
entityId: 'abc',
group: 'operations',
revision: 3,
payload: { name: 'Acme' },
});
assert.equal(doc.validateSync(), undefined);
assert.equal(doc.status, 'pending');
assert.equal(doc.attempts, 0);
});

test('sync outbox rejects an unknown target', () => {
const doc = new SyncOutbox({
eventId: 'evt-2', target: 'other', entity: 'store', entityId: 'abc', group: 'operations', revision: 1, payload: {},
});
assert.notEqual(doc.validateSync(), undefined);
});

test('sync outbox uses the Payload status set, which has no failed state', () => {
const doc = new SyncOutbox({
eventId: 'evt-3', target: 'seller', entity: 'store', entityId: 'abc', group: 'governance', revision: 1, payload: {},
});
doc.status = 'failed' as never;
assert.notEqual(doc.validateSync(), undefined);
});

test('sync outbox requires an eventId', () => {
const doc = new SyncOutbox({
target: 'seller', entity: 'store', entityId: 'abc', group: 'governance', revision: 1, payload: {},
});
assert.notEqual(doc.validateSync(), undefined);
});
