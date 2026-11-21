import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain .mjs script module without types; tests are not type-checked (tsconfig excludes test)
import * as planNs from '../../../../scripts/lib/bootstrap-admin-plan.mjs';

const { planBootstrap, targetDecision, SETTINGS_DEFAULTS, PLATFORM_SETTINGS_GLOBAL_TYPE } = ((planNs as { default?: unknown }).default ?? planNs) as {
  planBootstrap: (existing: Record<string, unknown>) => {
    createSettings: Record<string, unknown> | null;
    createMirrors: Array<{ id: string; sellerId: string }>;
    counts: Record<string, number>;
  };
  targetDecision: (name: string, flags: { apply: boolean; iKnowThisIsReal: boolean }) => { ok: boolean; reason: string };
  SETTINGS_DEFAULTS: Record<string, unknown>;
  PLATFORM_SETTINGS_GLOBAL_TYPE: string;
};

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);

test('an empty database: settings with the code defaults, no mirrors', () => {
  const plan = planBootstrap({ settingsDocs: [], sellerUsers: [], stores: [], sellerMirrors: [] });
  assert.deepEqual(plan.createSettings, {
    globalType: PLATFORM_SETTINGS_GLOBAL_TYPE,
    defaultCommissionRate: 4,
    maxStoresPerSeller: 3,
    settingsRevision: 0,
    storeApprovalRequired: false,
    codCommissionPercent: 0,
    graceDays: 7,
    trialDays: 0,
  });
  assert.equal(plan.createSettings?.defaultCommissionRate, SETTINGS_DEFAULTS.defaultCommissionRate);
  assert.deepEqual(plan.createMirrors, []);
});

test('an existing settings document is never replaced', () => {
  const plan = planBootstrap({ settingsDocs: [{ _id: 'x', defaultCommissionRate: 9 }], sellerUsers: [], stores: [], sellerMirrors: [] });
  assert.equal(plan.createSettings, null);
  assert.equal(plan.counts.settingsPresent, 1);
  assert.equal(plan.counts.settingsToCreate, 0);
});

test('one mirror per seller that owns a store; a seller without a store gets none', () => {
  const plan = planBootstrap({
    settingsDocs: [{ _id: 's' }],
    sellerUsers: [{ _id: A }, { _id: B }, { _id: C }],
    stores: [{ owner: A }, { owner: A }, { owner: B }, { owner: null }, {}],
    sellerMirrors: [],
  });
  assert.deepEqual(plan.createMirrors, [
    { id: A, sellerId: A },
    { id: B, sellerId: B },
  ]);
  assert.equal(plan.counts.sellersWithoutStore, 1);
  assert.equal(plan.counts.mirrorsToCreate, 2);
});

test('a store whose owner is not a seller user creates nothing', () => {
  const plan = planBootstrap({ settingsDocs: [{ _id: 's' }], sellerUsers: [{ _id: A }], stores: [{ owner: B }], sellerMirrors: [] });
  assert.deepEqual(plan.createMirrors, []);
});

test('existing mirrors are left alone, whether found by _id plus sellerId or by sellerId', () => {
  const plan = planBootstrap({
    settingsDocs: [{ _id: 's' }],
    sellerUsers: [{ _id: A }, { _id: B }],
    stores: [{ owner: A }, { owner: B }],
    sellerMirrors: [{ _id: A, sellerId: A }, { _id: 'other', sellerId: B }],
  });
  assert.deepEqual(plan.createMirrors, []);
  assert.equal(plan.counts.mirrorsAlreadyThere, 2);
});

test('a mirror row without a sellerId is reported, not updated and not duplicated', () => {
  const plan = planBootstrap({ settingsDocs: [{ _id: 's' }], sellerUsers: [{ _id: A }], stores: [{ owner: A }], sellerMirrors: [{ _id: A }] });
  assert.deepEqual(plan.createMirrors, []);
  assert.equal(plan.counts.mirrorsWithoutSellerId, 1);
});

test('ObjectId-like values are compared by their text; a repeated user counts once', () => {
  const objectIdLike = (hex: string) => ({ toString: () => hex });
  const plan = planBootstrap({
    settingsDocs: [{ _id: 's' }],
    sellerUsers: [{ _id: objectIdLike(A) }, { _id: objectIdLike(A) }],
    stores: [{ owner: objectIdLike(A) }],
    sellerMirrors: [],
  });
  assert.deepEqual(plan.createMirrors, [{ id: A, sellerId: A }]);
  assert.equal(plan.counts.sellerUsers, 1);
});

test('running the plan again on its own result creates nothing (idempotent)', () => {
  const first = planBootstrap({ settingsDocs: [], sellerUsers: [{ _id: A }, { _id: B }], stores: [{ owner: A }, { owner: B }], sellerMirrors: [] });
  const second = planBootstrap({
    settingsDocs: [{ _id: 's', ...first.createSettings }],
    sellerUsers: [{ _id: A }, { _id: B }],
    stores: [{ owner: A }, { owner: B }],
    sellerMirrors: first.createMirrors.map((row) => ({ _id: row.id, sellerId: row.sellerId })),
  });
  assert.equal(second.createSettings, null);
  assert.deepEqual(second.createMirrors, []);
});

test('target guard: safe names pass, other names need the flag, the dry run needs it too', () => {
  const off = { apply: false, iKnowThisIsReal: false };
  assert.equal(targetDecision('markaz_throwaway_1', { apply: true, iKnowThisIsReal: false }).ok, true);
  assert.equal(targetDecision('Markaz-TEST', off).ok, true);
  assert.equal(targetDecision('markaz', off).ok, false);
  assert.equal(targetDecision('markaz', { apply: true, iKnowThisIsReal: false }).ok, false);
  assert.equal(targetDecision('markaz', { apply: true, iKnowThisIsReal: true }).ok, true);
  assert.equal(targetDecision('', { apply: true, iKnowThisIsReal: false }).ok, false);
});

test('Sprint 6: the bootstrap defaults carry COD 0 percent, a 7 day grace and no trial (D-116, D-118)', () => {
  assert.equal(SETTINGS_DEFAULTS.codCommissionPercent, 0);
  assert.equal(SETTINGS_DEFAULTS.graceDays, 7);
  assert.equal(SETTINGS_DEFAULTS.trialDays, 0);
  // The texts have no default: an unset payment instruction or support contact is simply missing.
  assert.equal('paymentInstructions' in SETTINGS_DEFAULTS, false);
  assert.equal('supportEmail' in SETTINGS_DEFAULTS, false);
  assert.equal('supportPhone' in SETTINGS_DEFAULTS, false);
  const plan = planBootstrap({ settingsDocs: [], sellerUsers: [], stores: [], sellerMirrors: [] });
  assert.equal(plan.createSettings?.codCommissionPercent, 0);
});
