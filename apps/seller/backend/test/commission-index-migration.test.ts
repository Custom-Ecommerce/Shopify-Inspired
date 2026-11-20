import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommissionEntry } from '@/lib/services';
// @ts-expect-error plain .mjs script module without types; tests are not type-checked (tsconfig excludes test)
import * as planNs from '../../../../scripts/lib/migrate-commission-index-plan.mjs';

// Sprint 5 EP-13.US03.T02 (audit R1): the planning of scripts/migrate-commission-index.mjs. The script itself is never run by a test (it needs a
// database); every decision it makes is in this pure module.

type Index = { name?: string; key?: Record<string, number>; unique?: boolean };
const plan = ((planNs as { default?: unknown }).default ?? planNs) as {
  COLLECTION: string;
  OLD_INDEX: { name: string; key: Record<string, number> };
  NEW_INDEX: { name: string; key: Record<string, number>; options: { unique: boolean } };
  targetDecision: (name: string, flags: { apply: boolean; iKnowThisIsReal: boolean }) => { ok: boolean; reason: string };
  sameKey: (a: Record<string, number>, b: Record<string, number>) => boolean;
  planIndexMigration: (indexes: Index[]) => { state: string; hasNew: boolean; hasOld: boolean; steps: Array<{ action: string; name: string }> };
  isMissingCollection: (err: unknown) => boolean;
};

const ID: Index = { name: '_id_', key: { _id: 1 } };
const OLD: Index = { name: 'order_type_reverses_unique', key: { order: 1, type: 1, reversesType: 1 }, unique: true };
const NEW: Index = { name: 'order_type_reverses_return_unique', key: { order: 1, type: 1, reversesType: 1, returnId: 1 }, unique: true };
const STORE_SETTLED: Index = { name: 'store_1_settledAt_1', key: { store: 1, settledAt: 1 } };

test('the target guard: a database with "throwaway" in its name is allowed, any other needs --i-know-this-is-real, even for the dry run', () => {
  for (const apply of [false, true]) {
    assert.deepEqual(plan.targetDecision('markaz-throwaway-1', { apply, iKnowThisIsReal: false }), { ok: true, reason: 'safe-name' });
    assert.equal(plan.targetDecision('THROWAWAY', { apply, iKnowThisIsReal: false }).ok, true, 'case does not matter');
    assert.equal(plan.targetDecision('markaz-seller', { apply, iKnowThisIsReal: false }).ok, false);
    assert.equal(plan.targetDecision('', { apply, iKnowThisIsReal: false }).ok, false);
    assert.equal(plan.targetDecision('markaz-seller', { apply, iKnowThisIsReal: true }).ok, true);
  }
  assert.equal(plan.targetDecision('markaz-seller', { apply: true, iKnowThisIsReal: true }).reason, 'confirmed-apply');
  assert.equal(plan.targetDecision('markaz-seller', { apply: false, iKnowThisIsReal: true }).reason, 'confirmed-dry-run');
});

test('the old index becomes the new one: create the new FIRST, then drop the old (in that order)', () => {
  const result = plan.planIndexMigration([ID, OLD, STORE_SETTLED]);
  assert.equal(result.state, 'needs-both');
  assert.deepEqual(result.steps, [
    { action: 'create', name: 'order_type_reverses_return_unique' },
    { action: 'drop', name: 'order_type_reverses_unique' },
  ]);
  assert.equal(result.steps[0]!.action, 'create', 'at no moment is the ledger without a unique guard');
});

test('it is idempotent: with the new index there and the old one gone there is nothing to do, however often it runs', () => {
  const done = plan.planIndexMigration([ID, NEW, STORE_SETTLED]);
  assert.deepEqual(done, { state: 'done', hasNew: true, hasOld: false, steps: [] });
  assert.deepEqual(plan.planIndexMigration([ID, NEW]).steps, []);
});

test('an interrupted run is finished: the new one is there and the old one still is, so only the drop is left', () => {
  const result = plan.planIndexMigration([ID, OLD, NEW]);
  assert.equal(result.state, 'needs-drop');
  assert.deepEqual(result.steps, [{ action: 'drop', name: 'order_type_reverses_unique' }]);
});

test('a collection that does not exist yet (or has no indexes) only needs the new index; the model builds it on its own', () => {
  for (const indexes of [[], [ID], undefined as unknown as Index[]]) {
    const result = plan.planIndexMigration(indexes);
    assert.equal(result.state, 'needs-create');
    assert.deepEqual(result.steps, [{ action: 'create', name: 'order_type_reverses_return_unique' }]);
  }
  assert.equal(plan.isMissingCollection({ code: 26 }), true);
  assert.equal(plan.isMissingCollection({ codeName: 'NamespaceNotFound' }), true);
  assert.equal(plan.isMissingCollection(new Error('boom')), false);
  assert.equal(plan.isMissingCollection(null), false);
});

test('the old index is found by its key even under another name, and a different key or a non-unique index is not mistaken for it', () => {
  assert.equal(plan.planIndexMigration([ID, { ...OLD, name: 'custom_name' }]).hasOld, true);
  assert.deepEqual(plan.planIndexMigration([ID, { ...OLD, name: 'custom_name' }]).steps[1], { action: 'drop', name: 'custom_name' });
  assert.equal(plan.planIndexMigration([ID, { ...OLD, name: 'x', unique: false }]).hasOld, false, 'a plain index with the same key is left alone');
  assert.equal(plan.planIndexMigration([ID, { name: 'order_1', key: { order: 1 } }]).hasOld, false);
  // A new-key index that is not unique is not the guard: it still has to be created.
  assert.equal(plan.planIndexMigration([ID, { ...NEW, unique: false }]).hasNew, false);
  // The new key under a name someone chose by hand counts.
  assert.equal(plan.planIndexMigration([ID, { ...NEW, name: 'by_hand' }]).hasNew, true);
});

test('keys compare by field, order and direction', () => {
  assert.equal(plan.sameKey({ a: 1, b: 1 }, { a: 1, b: 1 }), true);
  assert.equal(plan.sameKey({ a: 1, b: 1 }, { b: 1, a: 1 }), false, 'the order of fields matters in an index');
  assert.equal(plan.sameKey({ a: 1 }, { a: -1 }), false);
  assert.equal(plan.sameKey({ a: 1 }, { a: 1, b: 1 }), false);
});

test('the names in the plan match the model: the new key and name are the ones the schema builds, the old ones are what Sprint 4 built', () => {
  assert.equal(plan.COLLECTION, (CommissionEntry as any).collection.name);
  const unique = (CommissionEntry as any).schema.indexes().find(([, options]: any[]) => options?.unique);
  assert.deepEqual(unique[0], plan.NEW_INDEX.key);
  assert.equal(unique[1].name, plan.NEW_INDEX.name);
  assert.equal(plan.NEW_INDEX.options.unique, true);
  assert.deepEqual(plan.OLD_INDEX.key, { order: 1, type: 1, reversesType: 1 });
  assert.equal(plan.OLD_INDEX.name, 'order_type_reverses_unique');
  assert.notEqual(plan.OLD_INDEX.name, plan.NEW_INDEX.name, 'two names, so the new index can be created while the old one still exists');
});
