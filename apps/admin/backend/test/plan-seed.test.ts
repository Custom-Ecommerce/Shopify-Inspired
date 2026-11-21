import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionPlanModel } from '@/lib/workspace';
import { createPlanRequestSchema } from '../../../../packages/contracts/src/plans';
import * as planNs from '../../../../scripts/lib/bootstrap-admin-plan.mjs';
import { PLANS as MARKETING_PLANS } from '../../../storefront/content/marketing/pricing';

// Sprint 6 EP-14.US01.T05 (D-118): the Free and Growth seed. Pure planning: no database.

type Seed = { key: string; name: string; priceRs: number; interval: string; limits: Record<string, unknown>; features: string[]; sortOrder: number };
type Created = Seed & { isActive: boolean; archivedAt: null; revision: number };
const plan = ((planNs as { default?: unknown }).default ?? planNs) as {
  PLAN_SEEDS: readonly Seed[];
  planBootstrap: (existing: Record<string, unknown>) => { createPlans: Created[]; counts: Record<string, number> };
};

const empty = { settingsDocs: [{ _id: 's' }], sellerUsers: [], stores: [], sellerMirrors: [] };
const seed = (key: string): Seed => plan.PLAN_SEEDS.find((candidate) => candidate.key === key)!;

test('the seed is the Free plan and the Growth plan of D-118', () => {
  assert.deepEqual(plan.PLAN_SEEDS.map((p) => p.key), ['free', 'growth']);
  assert.deepEqual(seed('free').limits, { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false });
  assert.equal(seed('free').priceRs, 0);
  assert.deepEqual(seed('growth').limits, { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true });
  assert.equal(seed('growth').priceRs, 2500);
  for (const p of plan.PLAN_SEEDS) {
    assert.equal(p.interval, 'month');
    assert.equal(Number.isInteger(p.priceRs), true, 'whole rupees');
  }
});

test('the seeded plans pass the create contract and the plan model, so what is stored can be read and edited', () => {
  for (const p of plan.PLAN_SEEDS) {
    assert.equal(createPlanRequestSchema.safeParse({ key: p.key, name: p.name, priceRs: p.priceRs, limits: p.limits, features: p.features, sortOrder: p.sortOrder, reason: 'Seed' }).success, true, p.key);
    assert.equal(new SubscriptionPlanModel({ ...p, limits: { ...p.limits }, features: [...p.features] }).validateSync(), undefined, p.key);
  }
});

test('an empty database gets both plans, active, at revision 0, not archived; the seed itself is never changed by the plan', () => {
  const result = plan.planBootstrap({ ...empty, planDocs: [] });
  assert.deepEqual(result.createPlans.map((p) => p.key), ['free', 'growth']);
  for (const row of result.createPlans) assert.deepEqual([row.isActive, row.revision, row.archivedAt], [true, 0, null]);
  assert.deepEqual([result.counts.plansPresent, result.counts.plansToCreate], [0, 2]);
  result.createPlans[0]!.limits.stores = 99;
  assert.equal(seed('free').limits.stores, 1, 'a created row is a copy');
  assert.equal(plan.planBootstrap(empty).createPlans.length, 2, 'no plan list at all counts as none');
});

test('a plan that exists is never created again or overwritten, edited or archived, and only the missing one is created', () => {
  const both = plan.planBootstrap({ ...empty, planDocs: [{ key: 'free', priceRs: 100 }, { key: 'growth', isActive: false }] });
  assert.deepEqual(both.createPlans, []);
  assert.deepEqual([both.counts.plansPresent, both.counts.plansToCreate], [2, 0]);
  const one = plan.planBootstrap({ ...empty, planDocs: [{ key: 'free' }] });
  assert.deepEqual(one.createPlans.map((p) => p.key), ['growth']);
});

test('the seed is idempotent: after creating what is missing, a second plan finds nothing to create', () => {
  const first = plan.planBootstrap({ ...empty, planDocs: [] });
  const second = plan.planBootstrap({ ...empty, planDocs: first.createPlans.map((p) => ({ key: p.key })) });
  assert.deepEqual(second.createPlans, []);
});

test('old plans without a key (name, price id, tier) do not count as Free or Growth', () => {
  const result = plan.planBootstrap({ ...empty, planDocs: [{ name: 'Free', tier: 'basic' }, { key: null }, { key: '' }] });
  assert.deepEqual(result.createPlans.map((p) => p.key), ['free', 'growth']);
});

test('the key is matched exactly: a plan called FREE or free-2 is not Free', () => {
  const result = plan.planBootstrap({ ...empty, planDocs: [{ key: 'FREE' }, { key: 'free-2' }] });
  assert.deepEqual(result.createPlans.map((p) => p.key), ['free', 'growth']);
});

// ---------------------------------------------------------------------------------------------------- drift: the marketing pricing page

const marketing = (id: string) => MARKETING_PLANS.find((p) => p.id === id)!;

test('drift: the seeded Free and Growth match apps/storefront/content/marketing/pricing.ts on price, product limit, domain and themes', () => {
  for (const key of ['free', 'growth']) {
    const seeded = seed(key);
    const shown = marketing(key);
    assert.ok(shown, key + ' is on the pricing page');
    assert.equal(seeded.name, shown.name, key + ' name');
    assert.equal(seeded.priceRs, shown.monthlyPrice, key + ' price');
    const text = shown.features.join(' | ').toLowerCase();

    // product limit: "Up to 10 products" / "Unlimited products"
    const upTo = /up to (\d+) products/.exec(text);
    if (upTo) assert.equal(seeded.limits.products, Number(upTo[1]), key + ' product limit');
    else assert.equal(/unlimited products/.test(text) ? null : 'unknown', seeded.limits.products, key + ' product limit (unlimited is null)');

    // domain: Growth promises a custom domain, Free a Markazify subdomain only
    assert.equal(/custom domain/.test(text), seeded.limits.customDomain, key + ' custom domain');

    // themes: Growth has premium themes, Free standard themes only
    assert.equal(/premium themes/.test(text), seeded.limits.premiumThemes, key + ' premium themes');
    assert.equal(/standard themes/.test(text), !seeded.limits.premiumThemes, key + ' standard themes');
  }
});

test('drift: the marketing page lists exactly the plans that are seeded, and the seed lists the marketing features word for word', () => {
  assert.deepEqual(MARKETING_PLANS.map((p) => p.id), plan.PLAN_SEEDS.map((p) => p.key));
  for (const shown of MARKETING_PLANS) assert.deepEqual([...seed(shown.id).features], [...shown.features], shown.id + ' features');
});

test('the limits the marketing page does not mention (stores, staff seats, API keys) are the D-118 values', () => {
  const free = seed('free').limits;
  const growth = seed('growth').limits;
  assert.deepEqual([free.stores, free.staffSeats, free.apiKeys], [1, 0, 0]);
  assert.deepEqual([growth.stores, growth.staffSeats, growth.apiKeys], [3, 3, 3]);
});
