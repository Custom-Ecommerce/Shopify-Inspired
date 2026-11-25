import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_INVALID_MESSAGE,
  TEAM_ERROR_CODES,
  TEAM_INVITE_TTL_DAYS,
  TEAM_ROLES,
  storeAccessSchema,
  teamAcceptRequestSchema,
  teamInviteInfoSchema,
  teamInviteRequestSchema,
  teamListResponseSchema,
  teamMemberActionRequestSchema,
  teamRoleChangeRequestSchema,
} from '../src/team';
import { workspaceStoreSchema } from '../src/workspace';
import { failingPaths } from './helpers';

// Sprint 8 (S8-B2, D-118): the team contracts. Every body is strict.

const ID = '65a000000000000000000011';

test('the roles are manager, staff and support; an invite lasts 7 days', () => {
  assert.deepEqual([...TEAM_ROLES], ['manager', 'staff', 'support']);
  assert.equal(TEAM_INVITE_TTL_DAYS, 7);
});

test('an invite is an email and a role: the email is trimmed and lower-cased, the role is a staff role', () => {
  const ok = teamInviteRequestSchema.safeParse({ email: '  Sara@Example.PK ', role: 'staff' });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.success ? ok.data : null, { email: 'sara@example.pk', role: 'staff' });
  for (const role of TEAM_ROLES) assert.equal(teamInviteRequestSchema.safeParse({ email: 'a@b.pk', role }).success, true, role);
});

test('an invite refuses a bad email, a role that is not a staff role (owner included) and any other key, naming the field', () => {
  const bad: Array<[unknown, string]> = [
    [{ role: 'staff' }, 'email'],
    [{ email: '', role: 'staff' }, 'email'],
    [{ email: 'no-at-sign', role: 'staff' }, 'email'],
    [{ email: 'a@b', role: 'staff' }, 'email'],
    [{ email: 'a b@c.pk', role: 'staff' }, 'email'],
    [{ email: '<a@b.pk>', role: 'staff' }, 'email'],
    [{ email: 'a'.repeat(250) + '@b.pk', role: 'staff' }, 'email'],
    [{ email: 'a@b.pk' }, 'role'],
    [{ email: 'a@b.pk', role: 'owner' }, 'role'],
    [{ email: 'a@b.pk', role: 'admin' }, 'role'],
    [{ email: 'a@b.pk', role: 'MANAGER' }, 'role'],
    [{ email: 'a@b.pk', role: null }, 'role'],
  ];
  for (const [body, field] of bad) {
    const result = teamInviteRequestSchema.safeParse(body);
    assert.equal(result.success, false, JSON.stringify(body));
    assert.ok(failingPaths(result).includes(field), JSON.stringify(body) + ' -> ' + failingPaths(result).join(','));
  }
  for (const key of ['store', 'status', 'tokenHash', 'user', 'revision']) assert.equal(teamInviteRequestSchema.safeParse({ email: 'a@b.pk', role: 'staff', [key]: 'x' }).success, false, key);
});

test('a role change and a member action need the revision that was read (a whole number, not negative) and nothing else', () => {
  assert.equal(teamRoleChangeRequestSchema.safeParse({ role: 'support', revision: 0 }).success, true);
  assert.equal(teamMemberActionRequestSchema.safeParse({ revision: 3 }).success, true);
  for (const bad of [{}, { revision: -1 }, { revision: 1.5 }, { revision: '1' }, { revision: null }, { revision: 1, role: 'staff' }]) {
    assert.equal(teamMemberActionRequestSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  for (const bad of [{ role: 'staff' }, { revision: 0 }, { role: 'owner', revision: 0 }, { role: 'staff', revision: 0, email: 'a@b.pk' }]) {
    assert.equal(teamRoleChangeRequestSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test('the accept body is { token } and nothing else: no store (the invite names it)', () => {
  assert.equal(teamAcceptRequestSchema.safeParse({ token: 'A'.repeat(43) }).success, true);
  for (const bad of [{}, { token: 'short' }, { token: 'A'.repeat(201) }, { token: 5 }, { token: 'A'.repeat(43), store: ID }, { token: 'A'.repeat(43), email: 'a@b.pk' }]) {
    assert.equal(teamAcceptRequestSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test('the invite info is a valid answer with the store, role and email, or exactly { valid: false } (one neutral answer)', () => {
  assert.equal(teamInviteInfoSchema.safeParse({ valid: true, storeName: 'Zara', role: 'staff', email: 'a@b.pk' }).success, true);
  assert.equal(teamInviteInfoSchema.safeParse({ valid: false }).success, true);
  assert.equal(teamInviteInfoSchema.safeParse({ valid: true, storeName: 'Zara', role: 'owner', email: 'a@b.pk' }).success, false);
  assert.equal(teamInviteInfoSchema.safeParse({ valid: true }).success, false);
});

test('the list answer carries members and the seats against the plan (null is unlimited)', () => {
  const member = { id: ID, email: 'a@b.pk', name: null, role: 'staff', status: 'invited', invitedAt: '2026-11-22T10:00:00.000Z', inviteExpiresAt: '2026-11-29T10:00:00.000Z', inviteExpired: false, acceptedAt: null, revision: 0 };
  assert.equal(teamListResponseSchema.safeParse({ members: [member], seats: { used: 1, limit: 3 } }).success, true);
  assert.equal(teamListResponseSchema.safeParse({ members: [member], seats: { used: 1, limit: null } }).success, true);
  assert.equal(teamListResponseSchema.safeParse({ members: [{ ...member, status: 'removed' }], seats: { used: 1, limit: 3 } }).success, false);
  assert.equal(teamListResponseSchema.safeParse({ members: [{ ...member, role: 'owner' }], seats: { used: 1, limit: 3 } }).success, false);
});

test('a store of the signed-in user carries a role: owner or a staff role; the workspace store accepts it and still parses without one', () => {
  for (const role of ['owner', 'manager', 'staff', 'support']) assert.equal(storeAccessSchema.safeParse({ id: ID, role }).success, true, role);
  assert.equal(storeAccessSchema.safeParse({ id: ID, role: 'admin' }).success, false);
  const store = { id: ID, name: 'Zara', slug: 'zara', status: 'active' };
  assert.equal(workspaceStoreSchema.safeParse(store).success, true, 'an older backend sends no role');
  assert.equal(workspaceStoreSchema.safeParse({ ...store, role: 'manager' }).success, true);
  assert.equal(workspaceStoreSchema.safeParse({ ...store, role: 'god' }).success, false);
});

test('the codes and the neutral message exist, and the message says nothing about why', () => {
  assert.equal(TEAM_ERROR_CODES.INVITE_INVALID, 'INVITE_INVALID');
  assert.equal(TEAM_ERROR_CODES.NOT_OWNER_YET, 'NOT_OWNER_YET');
  assert.equal(TEAM_ERROR_CODES.CAPABILITY_DENIED, 'CAPABILITY_DENIED');
  assert.match(INVITE_INVALID_MESSAGE, /may have expired or been used/);
});
