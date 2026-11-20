import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneE164 } from '@/lib/contracts';
// @ts-expect-error plain .mjs script module without types; tests are not type-checked (tsconfig excludes test)
import * as planNs from '../../../../scripts/lib/backfill-order-phone-key-plan.mjs';

// Sprint 5 EP-10.US01 (D-108): the planning of scripts/backfill-order-phone-key.mjs. The script itself is never run by a test (it
// needs a database); everything it decides is in this pure module. The phone rule is the contracts one, passed in.

const plan = ((planNs as { default?: unknown }).default ?? planNs) as {
  BATCH_SIZE: number;
  PENDING_FILTER: Record<string, unknown>;
  targetDecision: (name: string, flags: { apply: boolean; iKnowThisIsReal: boolean }) => { ok: boolean; reason: string };
  planPhoneKeys: (
    rows: Array<Record<string, unknown>>,
    normalize: (phone: unknown) => string | null,
  ) => { updates: Array<{ id: unknown; phoneKey: string }>; counts: Record<string, number> };
  bulkOperations: (updates: Array<{ id: unknown; phoneKey: string }>) => Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }>;
  addCounts: (total: Record<string, number>, part: Record<string, number>) => Record<string, number>;
};

test('the target guard: a database with "throwaway" in its name is allowed, any other needs --i-know-this-is-real, even for the dry run', () => {
  for (const apply of [false, true]) {
    assert.deepEqual(plan.targetDecision('markaz-throwaway-1', { apply, iKnowThisIsReal: false }), { ok: true, reason: 'safe-name' });
    assert.equal(plan.targetDecision('Throwaway', { apply, iKnowThisIsReal: false }).ok, true, 'case does not matter');
    for (const name of ['markaz', 'markaz-prod', 'markaz-test', 'staging', '', undefined as unknown as string]) {
      assert.equal(plan.targetDecision(name, { apply, iKnowThisIsReal: false }).ok, false, String(name) + ' without the flag');
      assert.equal(plan.targetDecision(name, { apply, iKnowThisIsReal: true }).ok, true, String(name) + ' with the flag');
    }
  }
  assert.equal(plan.targetDecision('markaz-test', { apply: false, iKnowThisIsReal: false }).ok, false, '"test" is NOT enough, unlike the admin bootstrap');
  assert.equal(plan.targetDecision('markaz', { apply: true, iKnowThisIsReal: true }).reason, 'confirmed-apply');
  assert.equal(plan.targetDecision('markaz', { apply: false, iKnowThisIsReal: true }).reason, 'confirmed-dry-run');
});

test('the plan sets a phoneKey only on an order that has none and a Pakistani mobile phone, using the contracts rule', () => {
  const rows = [
    { _id: 1, phone: '03001234567' },
    { _id: 2, phone: '+92 300 7654321' },
    { _id: 3, phone: '3001234567', phoneKey: '+923001234567' },
    { _id: 4, phone: '' },
    { _id: 5 },
    { _id: 6, phone: '021-1234567' },
    { _id: 7, phone: 'call me' },
    { _id: 8, phone: 12345 },
  ];
  const result = plan.planPhoneKeys(rows, normalizePhoneE164);
  assert.deepEqual(result.updates, [
    { id: 1, phoneKey: '+923001234567' },
    { id: 2, phoneKey: '+923007654321' },
  ]);
  assert.deepEqual(result.counts, { seen: 8, toSet: 2, alreadyKeyed: 1, noPhone: 3, notMobile: 2 });
});

test('the plan never touches phone, and its operations are guarded so a repeat or a race changes nothing', () => {
  const ops = plan.bulkOperations([{ id: 'a', phoneKey: '+923001234567' }]);
  assert.deepEqual(ops, [{ updateOne: { filter: { _id: 'a', phoneKey: { $exists: false } }, update: { $set: { phoneKey: '+923001234567' } } } }]);
  assert.deepEqual(Object.keys(ops[0]!.updateOne.update), ['$set']);
  assert.deepEqual(Object.keys((ops[0]!.updateOne.update as { $set: object }).$set), ['phoneKey'], 'only phoneKey is written');
  // Running it twice: the second plan, over the rows as the first left them, has nothing to set.
  const first = plan.planPhoneKeys([{ _id: 1, phone: '03001234567' }], normalizePhoneE164);
  const after = [{ _id: 1, phone: '03001234567', phoneKey: first.updates[0]!.phoneKey }];
  assert.equal(plan.planPhoneKeys(after, normalizePhoneE164).updates.length, 0);
});

test('the pending filter finds only orders with a phone and no phoneKey, and the counts add up across batches', () => {
  assert.deepEqual(plan.PENDING_FILTER, { phoneKey: { $exists: false }, phone: { $type: 'string', $ne: '' } });
  const total = { seen: 0, toSet: 0, alreadyKeyed: 0, noPhone: 0, notMobile: 0 };
  plan.addCounts(total, { seen: 2, toSet: 1, alreadyKeyed: 0, noPhone: 0, notMobile: 1 });
  plan.addCounts(total, { seen: 3, toSet: 3, alreadyKeyed: 0, noPhone: 0, notMobile: 0 });
  assert.deepEqual(total, { seen: 5, toSet: 4, alreadyKeyed: 0, noPhone: 0, notMobile: 1 });
  assert.equal(plan.BATCH_SIZE, 500);
});
