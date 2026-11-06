import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_OVERVIEW_NEW_SELLER_DAYS, adminOverviewSchema } from '../src/admin-overview';
import { failingPaths } from './helpers';

const NOW = '2026-10-11T10:00:00.000Z';
const bucket = { count: 3, orderAmount: 120000, commissionAmount: 4800 };
const overview = {
  stores: { total: 8, byStatus: { pending: 2, active: 5, suspended: 1, archived: 0 } },
  sellers: { total: 7, newInWindow: 2, windowDays: 30 },
  ledger: { pending: bucket, settled: { count: 0, orderAmount: 0, commissionAmount: 0 } },
  outbox: { counts: { pending: 1, sent: 10, dead: 0 }, oldestPendingAt: NOW, lastSentAt: NOW },
  generatedAt: NOW,
};

test('the overview answer parses, with null outbox times on an empty platform', () => {
  assert.equal(adminOverviewSchema.safeParse(overview).success, true);
  const empty = {
    stores: { total: 0, byStatus: { pending: 0, active: 0, suspended: 0, archived: 0 } },
    sellers: { total: 0, newInWindow: 0, windowDays: 30 },
    ledger: { pending: { count: 0, orderAmount: 0, commissionAmount: 0 }, settled: { count: 0, orderAmount: 0, commissionAmount: 0 } },
    outbox: { counts: { pending: 0, sent: 0, dead: 0 }, oldestPendingAt: null, lastSentAt: null },
    generatedAt: NOW,
  };
  assert.equal(adminOverviewSchema.safeParse(empty).success, true);
});

test('the overview refuses a negative or fractional count, a missing status, and a missing section', () => {
  const bad: unknown[] = [
    { ...overview, stores: { ...overview.stores, total: -1 } },
    { ...overview, stores: { ...overview.stores, byStatus: { pending: 2, active: 5, suspended: 1 } } },
    { ...overview, stores: { ...overview.stores, byStatus: { ...overview.stores.byStatus, active: 1.5 } } },
    { ...overview, sellers: { ...overview.sellers, windowDays: 0 } },
    { ...overview, sellers: { total: 7, windowDays: 30 } },
    { ...overview, ledger: { pending: bucket } },
    { ...overview, ledger: { ...overview.ledger, pending: { ...bucket, count: -2 } } },
    { ...overview, outbox: { ...overview.outbox, counts: { pending: 1, sent: 10 } } },
    { ...overview, outbox: { ...overview.outbox, oldestPendingAt: 'yesterday' } },
    { ...overview, generatedAt: 'now' },
  ];
  for (const body of bad) assert.equal(adminOverviewSchema.safeParse(body).success, false, JSON.stringify(body));
  const { outbox, ...withoutOutbox } = overview;
  void outbox;
  assert.deepEqual(failingPaths(adminOverviewSchema.safeParse(withoutOutbox)), ['outbox']);
  assert.deepEqual(failingPaths(adminOverviewSchema.safeParse({ ...overview, stores: { ...overview.stores, total: -1 } })), ['stores.total']);
});

test('the new-seller window is 30 days', () => {
  assert.equal(ADMIN_OVERVIEW_NEW_SELLER_DAYS, 30);
});
