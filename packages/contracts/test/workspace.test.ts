
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceSchema } from '../src/workspace';
import { failingPaths } from './helpers';

const UID = '65a000000000000000000007';
const SID = '65a000000000000000000001';

function validWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: UID, name: 'Ali', email: 'ali@example.com', accountStatus: 'active' },
    stores: [{ id: SID, name: 'Acme', slug: 'acme', status: 'active' }],
    limits: { used: 1, max: 3, canCreate: true },
    ...overrides,
  };
}

test('a workspace parses', () => {
  assert.equal(workspaceSchema.safeParse(validWorkspace()).success, true);
});

test('a negative used count is reported against limits.used', () => {
  const bad = validWorkspace({ limits: { used: -1, max: 3, canCreate: true } });
  assert.deepEqual(failingPaths(workspaceSchema.safeParse(bad)), ['limits.used']);
});

test('an unknown store status is reported against stores.0.status', () => {
  const bad = validWorkspace({ stores: [{ id: SID, name: 'Acme', slug: 'acme', status: 'deleted' }] });
  assert.deepEqual(failingPaths(workspaceSchema.safeParse(bad)), ['stores.0.status']);
});

test('an unknown account status is reported against user.accountStatus', () => {
  const bad = validWorkspace({ user: { id: UID, email: 'ali@example.com', accountStatus: 'banned' } });
  assert.deepEqual(failingPaths(workspaceSchema.safeParse(bad)), ['user.accountStatus']);
});
