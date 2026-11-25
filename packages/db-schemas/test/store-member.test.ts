import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreMember, STORE_MEMBER_ROLES, STORE_MEMBER_STATUSES } from '../src';

// Sprint 8 (S8-B2, D-118): the StoreMember model. Validation, defaults and indexes only: no database.

const member = {
  store: '65a000000000000000000011',
  email: 'Sara@Example.com',
  role: 'staff',
  invitedBy: '65a000000000000000000001',
};

test('a member needs its store, email, role and the owner who invited; the status starts as invited, revision 0, and there is no user yet', () => {
  const row = new StoreMember(member);
  assert.equal(row.validateSync(), undefined);
  assert.equal(row.status, 'invited');
  assert.equal(row.revision, 0);
  assert.equal(row.user, undefined);
  for (const field of ['store', 'email', 'role', 'invitedBy'] as const) {
    const { [field]: _omitted, ...rest } = member;
    void _omitted;
    assert.ok(new StoreMember(rest).validateSync()?.errors[field], field);
  }
});

test('the role is manager, staff or support (never owner) and the status is invited, active or disabled', () => {
  assert.deepEqual([...STORE_MEMBER_ROLES], ['manager', 'staff', 'support']);
  assert.deepEqual([...STORE_MEMBER_STATUSES], ['invited', 'active', 'disabled']);
  for (const role of STORE_MEMBER_ROLES) assert.equal(new StoreMember({ ...member, role }).validateSync(), undefined, role);
  for (const role of ['owner', 'admin', 'Manager', '']) assert.ok(new StoreMember({ ...member, role }).validateSync()?.errors.role, role);
  for (const status of STORE_MEMBER_STATUSES) assert.equal(new StoreMember({ ...member, status }).validateSync(), undefined, status);
  assert.ok(new StoreMember({ ...member, status: 'removed' }).validateSync()?.errors.status);
});

test('the invited email is stored lower case and trimmed', () => {
  assert.equal(new StoreMember({ ...member, email: '  Sara@Example.COM ' }).email, 'sara@example.com');
});

test('the token hash is a SHA-256 hex, and it is never selected by default', () => {
  const hash = 'a'.repeat(64);
  assert.equal(new StoreMember({ ...member, tokenHash: hash }).validateSync(), undefined);
  assert.ok(new StoreMember({ ...member, tokenHash: 'not-a-hash' }).validateSync()?.errors.tokenHash);
  assert.equal((StoreMember.schema.path('tokenHash') as unknown as { options: { select?: boolean } }).options.select, false);
});

test('the indexes: a member once per store (partial, rows with a user), one open invite per email per store, a token finds one invite, the stores of a user', () => {
  const indexes = StoreMember.schema.indexes() as Array<[Record<string, number>, Record<string, any>]>;
  const byName = (name: string) => indexes.find(([, options]) => options?.name === name);
  const storeUser = byName('store_user_unique');
  assert.deepEqual(storeUser?.[0], { store: 1, user: 1 });
  assert.equal(storeUser?.[1].unique, true);
  assert.deepEqual(storeUser?.[1].partialFilterExpression, { user: { $type: 'objectId' } });
  const email = byName('store_email_invited_unique');
  assert.deepEqual(email?.[0], { store: 1, email: 1 });
  assert.equal(email?.[1].unique, true);
  assert.deepEqual(email?.[1].partialFilterExpression, { status: 'invited' });
  const token = byName('tokenHash_unique');
  assert.deepEqual(token?.[0], { tokenHash: 1 });
  assert.equal(token?.[1].unique, true);
  assert.deepEqual(token?.[1].partialFilterExpression, { tokenHash: { $type: 'string' } });
  const user = byName('user_status');
  assert.deepEqual(user?.[0], { user: 1, status: 1 });
  assert.notEqual(user?.[1].unique, true);
  assert.equal(indexes.filter(([, options]) => options?.unique === true).length, 3);
});

test('the collection is storemembers and timestamps are on', () => {
  assert.equal(StoreMember.collection.name, 'storemembers');
  assert.ok(StoreMember.schema.path('createdAt'));
  assert.ok(StoreMember.schema.path('updatedAt'));
});
