import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archivePlanRequestSchema,
  adminPlanWriteResponseSchema,
  createPlanRequestSchema,
  planLimitsSchema,
  publicPlanListSchema,
  publicPlanSchema,
  updatePlanRequestSchema,
} from '../src/plans';
import { failingPaths } from './helpers';

// Sprint 6 EP-14 (D-118): the plan contracts. Whole rupees only, strict objects, one named field per problem.

const limits = { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true };
const create = { key: 'growth', name: 'Growth', priceRs: 2500, limits, features: ['Unlimited products'], sortOrder: 2, reason: 'Launch plan' };

test('a valid create passes, takes its defaults, and keeps null as unlimited', () => {
  const parsed = createPlanRequestSchema.parse(create);
  assert.equal(parsed.priceRs, 2500);
  assert.equal(parsed.limits.products, null);
  const minimal = createPlanRequestSchema.parse({ key: 'free', name: 'Free', priceRs: 0, limits: { ...limits, stores: 1, products: 10 }, reason: 'Seed' });
  assert.deepEqual(minimal.features, []);
  assert.equal(minimal.sortOrder, 0);
  assert.equal(minimal.stripePriceId, undefined);
});

test('the price is whole rupees: 0 is allowed, a fraction, a negative, a text and an absurd price are not', () => {
  assert.equal(createPlanRequestSchema.safeParse({ ...create, priceRs: 0 }).success, true);
  for (const bad of [2500.5, -1, '2500', null, 10_000_001, Number.NaN]) {
    const result = createPlanRequestSchema.safeParse({ ...create, priceRs: bad });
    assert.equal(result.success, false, String(bad));
    assert.deepEqual(failingPaths(result), ['priceRs'], String(bad));
  }
});

test('the key is a slug', () => {
  for (const good of ['free', 'pro-2', 'ab']) assert.equal(createPlanRequestSchema.safeParse({ ...create, key: good }).success, true, good);
  for (const bad of ['', 'Growth', '1plan', 'a', 'has space', 'x'.repeat(31), 'under_score']) {
    assert.deepEqual(failingPaths(createPlanRequestSchema.safeParse({ ...create, key: bad })), ['key'], bad);
  }
  assert.deepEqual(failingPaths(createPlanRequestSchema.safeParse({ ...create, key: undefined })), ['key']);
});

test('the name is 2 to 60 plain characters', () => {
  assert.equal(createPlanRequestSchema.safeParse({ ...create, name: '  Growth  ' }).success, true);
  for (const bad of ['', 'G', 'x'.repeat(61), '<b>Growth</b>']) assert.deepEqual(failingPaths(createPlanRequestSchema.safeParse({ ...create, name: bad })), ['name'], bad);
});

test('limits: whole numbers of 0 or more (stores 1 or more) or null; the switches are booleans; unknown limits are refused', () => {
  assert.equal(planLimitsSchema.safeParse({ ...limits, products: 0, staffSeats: 0, apiKeys: 0 }).success, true);
  assert.equal(planLimitsSchema.safeParse({ ...limits, stores: null }).success, true);
  for (const [field, value] of [
    ['stores', 0],
    ['stores', -1],
    ['products', -1],
    ['products', 2.5],
    ['staffSeats', '3'],
    ['apiKeys', 1_000_001],
    ['customDomain', 'yes'],
    ['premiumThemes', null],
  ] as const) {
    assert.deepEqual(failingPaths(planLimitsSchema.safeParse({ ...limits, [field]: value })), [field], field + '=' + String(value));
  }
  assert.equal(planLimitsSchema.safeParse({ ...limits, seats: 9 }).success, false);
  assert.equal(planLimitsSchema.safeParse({ stores: 1 }).success, false, 'every limit is stated');
  const nested = createPlanRequestSchema.safeParse({ ...create, limits: { ...limits, stores: 0 } });
  assert.deepEqual(failingPaths(nested), ['limits.stores']);
});

test('features: at most 12 lines of 80 plain characters', () => {
  assert.equal(createPlanRequestSchema.safeParse({ ...create, features: Array.from({ length: 12 }, (_, i) => 'Feature ' + i) }).success, true);
  assert.equal(createPlanRequestSchema.safeParse({ ...create, features: Array.from({ length: 13 }, (_, i) => 'Feature ' + i) }).success, false);
  assert.equal(createPlanRequestSchema.safeParse({ ...create, features: ['x'.repeat(81)] }).success, false);
  assert.equal(createPlanRequestSchema.safeParse({ ...create, features: ['  '] }).success, false);
  assert.equal(createPlanRequestSchema.safeParse({ ...create, features: ['<script>alert(1)</script>'] }).success, false);
});

test('the Stripe price is optional, null, or price_...; a reason is always required', () => {
  assert.equal(createPlanRequestSchema.safeParse({ ...create, stripePriceId: null }).success, true);
  assert.equal(createPlanRequestSchema.safeParse({ ...create, stripePriceId: 'price_1ABCdef' }).success, true);
  assert.deepEqual(failingPaths(createPlanRequestSchema.safeParse({ ...create, stripePriceId: 'prod_123' })), ['stripePriceId']);
  assert.deepEqual(failingPaths(createPlanRequestSchema.safeParse({ ...create, reason: undefined })), ['reason']);
  assert.deepEqual(failingPaths(createPlanRequestSchema.safeParse({ ...create, reason: 'no' })), ['reason']);
  assert.deepEqual(failingPaths(createPlanRequestSchema.safeParse({ ...create, reason: 'x'.repeat(301) })), ['reason']);
});

test('a create refuses unknown fields: id, revision, isActive, archivedAt, a tier', () => {
  for (const extra of [{ id: 'x' }, { revision: 1 }, { isActive: false }, { archivedAt: null }, { tier: 'pro' }, { priceUsd: 10 }]) {
    assert.equal(createPlanRequestSchema.safeParse({ ...create, ...extra }).success, false, JSON.stringify(extra));
  }
});

test('an update needs the revision, a reason and at least one change; the key never changes', () => {
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 2, name: 'Growth Plus', reason: 'Rename' }).success, true);
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 0, priceRs: 3000, reason: 'Price rise' }).success, true);
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 1, limits, reason: 'New limits' }).success, true);
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 1, stripePriceId: null, reason: 'Manual only' }).success, true);
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 1, isActive: true, reason: 'Bring it back' }).success, true);
  assert.equal(updatePlanRequestSchema.safeParse({ name: 'Growth Plus', reason: 'No revision' }).success, false);
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 1, reason: 'Nothing changes' }).success, false);
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 1, name: 'Growth Plus' }).success, false);
  assert.equal(updatePlanRequestSchema.safeParse({ revision: 1, key: 'other', name: 'Growth', reason: 'Rekey' }).success, false);
  assert.deepEqual(failingPaths(updatePlanRequestSchema.safeParse({ revision: 1, priceRs: 1.5, reason: 'Fraction' })), ['priceRs']);
  assert.deepEqual(failingPaths(updatePlanRequestSchema.safeParse({ revision: -1, name: 'Growth', reason: 'Bad revision' })), ['revision']);
  assert.deepEqual(failingPaths(updatePlanRequestSchema.safeParse({ revision: 1.5, name: 'Growth', reason: 'Bad revision' })), ['revision']);
});

test('an archive needs the revision and a reason and nothing else', () => {
  assert.equal(archivePlanRequestSchema.safeParse({ revision: 3, reason: 'Retired' }).success, true);
  assert.equal(archivePlanRequestSchema.safeParse({ reason: 'Retired' }).success, false);
  assert.equal(archivePlanRequestSchema.safeParse({ revision: 3 }).success, false);
  assert.equal(archivePlanRequestSchema.safeParse({ revision: 3, reason: 'Retired', hard: true }).success, false);
});

test('the public view has the plan facts and none of the admin fields', () => {
  const pub = { key: 'growth', name: 'Growth', priceRs: 2500, interval: 'month', limits, features: ['Unlimited products'], sortOrder: 2 };
  assert.equal(publicPlanSchema.safeParse(pub).success, true);
  assert.equal(publicPlanListSchema.safeParse({ plans: [pub] }).success, true);
  assert.equal(publicPlanSchema.safeParse({ ...pub, priceRs: 2500.5 }).success, false);
  assert.equal(publicPlanSchema.safeParse({ ...pub, interval: 'year' }).success, false);
  // a zod object strips what it does not know: the Stripe price and the revision cannot leak through the parse
  const stripped = publicPlanSchema.parse({ ...pub, stripePriceId: 'price_1', revision: 3, archivedAt: null }) as Record<string, unknown>;
  assert.equal('stripePriceId' in stripped, false);
  assert.equal('revision' in stripped, false);
});

test('the admin write answer carries the plan with its revision; an old plan has null key, price and limits', () => {
  const ID = '65a0000000000000000000c1';
  const NOW = '2026-11-20T10:00:00.000Z';
  const plan = { id: ID, key: 'growth', name: 'Growth', priceRs: 2500, interval: 'month', limits, features: [], isActive: true, sortOrder: 0, stripePriceId: null, revision: 1, archivedAt: null, createdAt: NOW, updatedAt: NOW };
  assert.equal(adminPlanWriteResponseSchema.safeParse({ plan }).success, true);
  assert.equal(adminPlanWriteResponseSchema.safeParse({ plan: { ...plan, key: null, priceRs: null, limits: null } }).success, true);
  assert.equal(adminPlanWriteResponseSchema.safeParse({ plan: { ...plan, revision: -1 } }).success, false);
});
