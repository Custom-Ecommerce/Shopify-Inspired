// Pure planning for scripts/ensure-indexes.mjs (Sprint 5 EP-11.US04.T04, D-111 (7)). No database, no env, no output.
// Tested by apps/seller/backend/test/ensure-indexes.test.ts.
//
// Sprint 6 CO-115: the unique index on subscription.seller (seller_unique, one subscription per seller) is declared by the Subscription model the same way.
// Sprint 6 EP-14: the unique index of a subscription plan's key (plan_key_unique, partial: old plans have no key) is declared by the model, so
// it needs no entry here: the plan below picks it up with every other declared index. A test (ensure-indexes.test.ts) pins that it does.
//
// Sprint 6 (S6-B4): the unique, PARTIAL index on subscriptionPayments.seller (seller_open_unique, partialFilterExpression { isOpen: true }) keeps ONE open
// payment per seller whatever races. It is declared by the SubscriptionPayment model, so the plan below picks it up with every other declared index;
// a test (ensure-indexes.test.ts) pins that it does. The filter is an equality: $in in a partial filter is not supported by every MongoDB version.
//
// Sprint 8 (S8-B2, D-118): the StoreMember model (storemembers) declares three unique PARTIAL indexes ({store,user} for rows with a user, {store,email} for status
// invited, {tokenHash} for rows with a hash) and {user,status}. They are declared on the model, so the plan picks them up like every other index; a test
// (ensure-indexes.test.ts) pins all four.
//
// Sprint 8 (S8-B4, D-118): the ApiKey model (apikeys) declares a unique {prefix} and {store, revokedAt}. Both are declared on the model, so the plan picks them up; a
// test (ensure-indexes.test.ts) pins them.
//
// Sprint 8 (S8-B6, D-118): the DailyStat (dailystats) and ProductDailyStat (productdailystats) models declare one unique index per row and a TTL index on
// expiresAt (400 days); the Referral model declares the unique PARTIAL reward slot {referrer, rewardMonth, rewardSlot}; the SubscriptionCredit model one unique
// {referral}. All are declared on the models, so the plan picks them up; a test (ensure-indexes.test.ts) pins them.
//
// The seller backend connects with bufferCommands false, so Mongoose builds no index by itself at runtime. This plan compares the indexes every
// model DECLARES (schema.indexes()) with the indexes a collection HAS (collection.indexes()) and says which are missing. The script then calls
// createIndexes() for the models that miss one: it never calls syncIndexes and never drops anything, so an index nobody declares stays.

/** May the script run against this database? The same guard as scripts/backfill-order-phone-key.mjs (also for the dry run). */
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

/** The name MongoDB gives an index that has no name of its own: field_direction joined by an underscore. */
export function defaultIndexName(key) {
  return Object.entries(key ?? {})
    .map(([field, direction]) => field + '_' + direction)
    .join('_');
}

/** Text of a value with object keys sorted, so two equal filters compare equal whatever order they were written in. */
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * The part of an index definition that changes what it does. The name is not part of it (a hand-built index with another name counts),
 * and neither is `background`.
 * @param {{ unique?: boolean, sparse?: boolean, partialFilterExpression?: unknown, expireAfterSeconds?: number } | undefined} options
 */
export function behaviourOf(options) {
  const o = options ?? {};
  return stable({
    unique: o.unique === true,
    sparse: o.sparse === true,
    partial: o.partialFilterExpression ?? null,
    ttl: typeof o.expireAfterSeconds === 'number' ? o.expireAfterSeconds : null,
  });
}

/**
 * What one collection needs.
 * @param {Array<[Record<string, number>, Record<string, unknown> | undefined]>} declared  schema.indexes() of the model
 * @param {Array<{ name?: string, key?: Record<string, number>, unique?: boolean, sparse?: boolean, partialFilterExpression?: unknown, expireAfterSeconds?: number }>} existing  collection.indexes()
 *        ([] when the collection does not exist yet)
 * @returns {{ present: number, missing: Array<{ key: Record<string, number>, name: string, unique: boolean, ttl: boolean, partial: boolean }>,
 *             conflicts: Array<{ key: Record<string, number>, name: string, reason: string }> }}
 */
export function planCollection(declared, existing) {
  const have = Array.isArray(existing) ? existing : [];
  const missing = [];
  const conflicts = [];
  let present = 0;
  for (const [key, options] of Array.isArray(declared) ? declared : []) {
    const name = typeof options?.name === 'string' && options.name !== '' ? options.name : defaultIndexName(key);
    const wanted = behaviourOf(options);
    const sameBehaviour = have.some((index) => sameKey(index.key, key) && behaviourOf(index) === wanted);
    if (sameBehaviour) {
      present += 1;
      continue;
    }
    // The name is taken by an index that does something else: createIndex would fail with an options conflict. Report it, change nothing.
    const taken = have.find((index) => index.name === name);
    if (taken !== undefined) {
      conflicts.push({ key, name, reason: 'an index with this name exists with a different key or options' });
      continue;
    }
    missing.push({ key, name, unique: options?.unique === true, ttl: typeof options?.expireAfterSeconds === 'number', partial: options?.partialFilterExpression !== undefined });
  }
  return { present, missing, conflicts };
}

/**
 * @param {Array<{ model: string, collection: string, declared: Array<[Record<string, number>, Record<string, unknown> | undefined]> }>} models
 * @param {Record<string, Array<object>>} existingByCollection
 * @returns {{ models: Array<{ model: string, collection: string, present: number, missing: Array<object>, conflicts: Array<object> }>,
 *             totals: { present: number, missing: number, conflicts: number }, toCreate: string[] }}
 *          toCreate: the models whose createIndexes() must run (they miss an index and none of their indexes conflicts)
 */
export function planAll(models, existingByCollection) {
  const out = [];
  const totals = { present: 0, missing: 0, conflicts: 0 };
  const toCreate = [];
  const seen = new Set();
  for (const entry of models) {
    // Two models on one collection are planned once.
    if (seen.has(entry.collection)) continue;
    seen.add(entry.collection);
    const plan = planCollection(entry.declared, existingByCollection[entry.collection] ?? []);
    out.push({ model: entry.model, collection: entry.collection, ...plan });
    totals.present += plan.present;
    totals.missing += plan.missing.length;
    totals.conflicts += plan.conflicts.length;
    if (plan.missing.length > 0 && plan.conflicts.length === 0) toCreate.push(entry.model);
  }
  return { models: out, totals, toCreate };
}

/** True when a driver error means "the collection does not exist yet": nothing is there, so every declared index is missing. */
export function isMissingCollection(err) {
  return typeof err === 'object' && err !== null && (err.code === 26 || err.codeName === 'NamespaceNotFound');
}
