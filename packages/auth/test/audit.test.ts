import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '@markaz/db-schemas';
import { POLICY_MATRIX } from '../src/policy';
import { can, PolicyDeniedError } from '../src/can';
import { writeAuditLog } from '../src/services/audit';

type Row = Record<string, unknown>;

const matrix = POLICY_MATRIX as unknown as Record<string, unknown>;
const originalAuditPolicy = matrix['audit-log'];

afterEach(() => {
mock.restoreAll();
matrix['audit-log'] = originalAuditPolicy;
});

function stubAudit() {
const created: Row[] = [];
mock.method(AuditLog as any, 'create', async (doc: Row) => {
created.push(doc);
return { _id: 'audit-1', ...doc };
});
return created;
}

function restrictCreateTo(actors: string[]) {
const original = originalAuditPolicy as { create: { fields: unknown } };
matrix['audit-log'] = { ...original, create: { actors, fields: original.create.fields } };
}

test('writeAuditLog stores the entry and returns its id', async () => {
const created = stubAudit();

const result = await writeAuditLog('store.suspend', 'store', 'store-1', 'user-7', { reason: 'fraud' });

assert.deepEqual(result, { id: 'audit-1' });
assert.equal(created.length, 1);
assert.deepEqual(created[0], {
action: 'store.suspend',
entity: 'store',
entityId: 'store-1',
actorId: 'user-7',
details: { reason: 'fraud' },
});
});

test('details is omitted from the record when not provided', async () => {
const created = stubAudit();

await writeAuditLog('store.reactivate', 'store', 'store-1', 'user-7');

assert.equal('details' in created[0], false);
});

test('the policy check runs as the system actor: a matrix that excludes system denies the write', async () => {
const created = stubAudit();

restrictCreateTo(['admin', 'seller']);
await assert.rejects(() => writeAuditLog('a', 'store', 's', 'u'), PolicyDeniedError);

restrictCreateTo([]);
await assert.rejects(() => writeAuditLog('a', 'store', 's', 'u'), PolicyDeniedError);

assert.equal(created.length, 0);
});

test('the shipped matrix lets only system create audit entries and nobody change them', () => {
assert.equal(can('system', 'create', 'audit-log'), true);
assert.equal(can('admin', 'create', 'audit-log'), false);
assert.equal(can('seller', 'create', 'audit-log'), false);
assert.equal(can('public', 'create', 'audit-log'), false);
assert.equal(can('system', 'update', 'audit-log', ['action']), false);
assert.equal(can('system', 'delete', 'audit-log'), false);
});

test('invalid input is rejected before touching the database', async () => {
const created = stubAudit();

await assert.rejects(() => writeAuditLog('', 'store', 's', 'u'), TypeError);
await assert.rejects(() => writeAuditLog('a', ' ', 's', 'u'), TypeError);
await assert.rejects(() => writeAuditLog('a', 'store', '', 'u'), TypeError);
await assert.rejects(() => writeAuditLog('a', 'store', 's', ''), TypeError);

assert.equal(created.length, 0);
});
