// Pure planning for scripts/migrate-commission-index.mjs (Sprint 5 EP-13.US03.T02, audit R1). No database, no env, no output.
// Tested by apps/seller/backend/test/commission-index-migration.test.ts.
//
// The ledger's unique index used to be { order, type, reversesType } (name order_type_reverses_unique): ONE reversal per order, so the
// second partial return of an order would hit a duplicate key. It becomes { order, type, reversesType, returnId }. Mongoose never alters a
// live index, so the script creates the new one FIRST and only then drops the old one; at no moment is the ledger without a unique guard.

export const COLLECTION = 'commissionentries';

export const OLD_INDEX = Object.freeze({ name: 'order_type_reverses_unique', key: Object.freeze({ order: 1, type: 1, reversesType: 1 }) });
export const NEW_INDEX = Object.freeze({
  name: 'order_type_reverses_return_unique',
  key: Object.freeze({ order: 1, type: 1, reversesType: 1, returnId: 1 }),
  options: Object.freeze({ unique: true }),
});

/**
 * May the script run against this database? Only a database whose name contains "throwaway" is allowed by itself. Any other name needs
 * --i-know-this-is-real, for the dry run as well as for --apply (the same guard as scripts/backfill-order-phone-key.mjs).
 */
export function targetDecision(databaseName, { apply, iKnowThisIsReal }) {
  const name = String(databaseName ?? '').toLowerCase();
  if (name.includes('throwaway')) return { ok: true, reason: 'safe-name' };
  if (iKnowThisIsReal) return { ok: true, reason: apply ? 'confirmed-apply' : 'confirmed-dry-run' };
  return { ok: false, reason: 'needs-throwaway-name-or-flag' };
}

/** Two index keys are the same when they list the same fields, in the same order, with the same direction. */
export function sameKey(a, b) {
  const left = Object.entries(a ?? {});
  const right = Object.entries(b ?? {});
  return left.length === right.length && left.every(([field, direction], index) => right[index]?.[0] === field && right[index]?.[1] === direction);
}

/**
 * @param {Array<{ name?: string, key?: Record<string, number>, unique?: boolean }>} indexes  what listIndexes returned ([] when the
 *        collection does not exist yet)
 * @returns {{ state: 'done' | 'needs-create' | 'needs-drop' | 'needs-both', hasNew: boolean, hasOld: boolean, steps: Array<{ action: 'create' | 'drop', name: string }> }}
 */
export function planIndexMigration(indexes) {
  const list = Array.isArray(indexes) ? indexes : [];
  // The new index counts by its key and uniqueness, whatever it is called (someone may have built it by hand).
  const hasNew = list.some((index) => sameKey(index.key, NEW_INDEX.key) && index.unique === true);
  // The old one by its name or by its key: it is the unique index over order, type and reversesType only.
  const old = list.find((index) => index.name === OLD_INDEX.name || (sameKey(index.key, OLD_INDEX.key) && index.unique === true));
  const hasOld = old !== undefined;
  const steps = [];
  if (!hasNew) steps.push({ action: 'create', name: NEW_INDEX.name });
  if (hasOld) steps.push({ action: 'drop', name: old.name });
  const state = hasNew && !hasOld ? 'done' : !hasNew && hasOld ? 'needs-both' : !hasNew ? 'needs-create' : 'needs-drop';
  return { state, hasNew, hasOld, steps };
}

/** True when a driver error means "the collection does not exist yet": nothing to migrate, the new model builds the right index itself. */
export function isMissingCollection(err) {
  return typeof err === 'object' && err !== null && (err.code === 26 || err.codeName === 'NamespaceNotFound');
}
