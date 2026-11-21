// Pure planning for scripts/bootstrap-admin-data.mjs (SB-12). No database, no env, no output: it only decides what is
// missing from the documents it is given. Tested by apps/admin/backend/test/bootstrap-admin-plan.test.ts.

export const PLATFORM_SETTINGS_GLOBAL_TYPE = 'platformSettings';

/** The defaults the code already uses (packages/db-schemas billing/platform-settings.ts; seller lib/platform-settings.ts). */
export const SETTINGS_DEFAULTS = Object.freeze({
  defaultCommissionRate: 4,
  maxStoresPerSeller: 3,
  settingsRevision: 0,
  storeApprovalRequired: false,
  // Sprint 6 (D-116, D-118): COD carries no commission by default; a lapsed plan keeps its limits for 7 days; no trial.
  codCommissionPercent: 0,
  graceDays: 7,
  trialDays: 0,
});

/**
 * May the script run against this database? A name containing "throwaway" or "test" is always allowed. Any other name
 * needs --i-know-this-is-real: with --apply it allows the write; without --apply it allows the (read-only) dry run, so the
 * plan can be previewed on the real database before it is applied. Without the flag nothing runs on such a name.
 */
export function targetDecision(databaseName, { apply, iKnowThisIsReal }) {
  const name = String(databaseName ?? '').toLowerCase();
  if (name.includes('throwaway') || name.includes('test')) return { ok: true, reason: 'safe-name' };
  if (iKnowThisIsReal) return { ok: true, reason: apply ? 'confirmed-apply' : 'confirmed-dry-run' };
  return { ok: false, reason: 'needs-safe-name-or-flag' };
}

function idOf(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : text;
}

/**
 * @param {{
 *   settingsDocs: Array<Record<string, unknown>>,   // documents of `globals` with globalType platformSettings
 *   sellerUsers: Array<{ _id: unknown }>,           // users with role seller
 *   stores: Array<{ owner?: unknown }>,             // stores (only `owner` is read)
 *   sellerMirrors: Array<{ _id?: unknown, sellerId?: unknown }>, // documents of `sellers`
 * }} existing
 */
export function planBootstrap(existing) {
  const settingsDocs = existing.settingsDocs ?? [];
  const sellerUsers = existing.sellerUsers ?? [];
  const stores = existing.stores ?? [];
  const sellerMirrors = existing.sellerMirrors ?? [];

  const createSettings = settingsDocs.length === 0 ? { globalType: PLATFORM_SETTINGS_GLOBAL_TYPE, ...SETTINGS_DEFAULTS } : null;

  const owners = new Set();
  for (const store of stores) {
    const owner = idOf(store.owner);
    if (owner) owners.add(owner);
  }

  const mirrorIds = new Set();
  const mirrorSellerIds = new Set();
  for (const mirror of sellerMirrors) {
    const id = idOf(mirror._id);
    if (id) mirrorIds.add(id);
    const sellerId = idOf(mirror.sellerId);
    if (sellerId) mirrorSellerIds.add(sellerId);
  }

  const createMirrors = [];
  let sellersWithoutStore = 0;
  let mirrorsAlreadyThere = 0;
  let mirrorsWithoutSellerId = 0;
  const seen = new Set();
  for (const user of sellerUsers) {
    const id = idOf(user._id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!owners.has(id)) {
      sellersWithoutStore += 1;
      continue;
    }
    if (mirrorSellerIds.has(id)) {
      mirrorsAlreadyThere += 1;
      continue;
    }
    if (mirrorIds.has(id)) {
      // A row with this _id exists but no sellerId. It is never updated here: reported only.
      mirrorsWithoutSellerId += 1;
      continue;
    }
    createMirrors.push({ id, sellerId: id });
  }

  return {
    createSettings,
    createMirrors,
    counts: {
      settingsPresent: settingsDocs.length,
      settingsToCreate: createSettings ? 1 : 0,
      sellerUsers: seen.size,
      sellersWithoutStore,
      mirrorsAlreadyThere,
      mirrorsWithoutSellerId,
      mirrorsToCreate: createMirrors.length,
    },
  };
}
