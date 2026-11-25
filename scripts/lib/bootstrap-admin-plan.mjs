// Pure planning for scripts/bootstrap-admin-data.mjs (SB-12). No database, no env, no output: it only decides what is
// missing from the documents it is given. Tested by apps/admin/backend/test/bootstrap-admin-plan.test.ts.

export const PLATFORM_SETTINGS_GLOBAL_TYPE = 'platformSettings';

/**
 * Sprint 6 EP-14 (D-118): the two plans every platform starts with. They are DATA: an admin edits them in the console afterwards, and this
 * script never touches a plan that exists (see planBootstrap). null is unlimited. Money is whole rupees. The facts here (price, the
 * product limit, custom domain, themes) must match apps/storefront/content/marketing/pricing.ts; a test checks it.
 */
export const PLAN_SEEDS = Object.freeze([
  Object.freeze({
    key: 'free',
    name: 'Free',
    priceRs: 0,
    interval: 'month',
    limits: Object.freeze({ stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false }),
    features: Object.freeze(['Up to 10 products', 'Standard themes', 'Cash on Delivery', 'Community support', 'Markazify subdomain']),
    sortOrder: 1,
  }),
  Object.freeze({
    key: 'growth',
    name: 'Growth',
    priceRs: 2500,
    interval: 'month',
    limits: Object.freeze({ stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true }),
    features: Object.freeze(['Unlimited products', 'Premium themes', 'Custom domain support', 'Local payment gateways', 'Priority WhatsApp support']),
    sortOrder: 2,
  }),
]);

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
  // Sprint 8 (S8-B5): one free month per rewarded referral, at most five a month.
  referralRewardMonths: 1,
  referralMonthlyCap: 5,
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
 *   planDocs?: Array<{ key?: unknown }>,            // documents of `subscriptionPlans` (only `key` is read)
 * }} existing
 */
export function planBootstrap(existing) {
  const settingsDocs = existing.settingsDocs ?? [];
  const sellerUsers = existing.sellerUsers ?? [];
  const stores = existing.stores ?? [];
  const sellerMirrors = existing.sellerMirrors ?? [];
  const planDocs = existing.planDocs ?? [];

  const createSettings = settingsDocs.length === 0 ? { globalType: PLATFORM_SETTINGS_GLOBAL_TYPE, ...SETTINGS_DEFAULTS } : null;

  // Sprint 6: a plan is created only when no plan has its key (archived ones count). A plan that exists is never updated: an admin may have
  // edited it, and the console is where plans change.
  const planKeys = new Set();
  for (const plan of planDocs) {
    const key = idOf(plan.key);
    if (key) planKeys.add(key);
  }
  const createPlans = PLAN_SEEDS.filter((seed) => !planKeys.has(seed.key)).map((seed) => ({
    key: seed.key,
    name: seed.name,
    priceRs: seed.priceRs,
    interval: seed.interval,
    limits: { ...seed.limits },
    features: [...seed.features],
    sortOrder: seed.sortOrder,
    isActive: true,
    archivedAt: null,
    revision: 0,
  }));

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
    createPlans,
    counts: {
      plansPresent: planKeys.size,
      plansToCreate: createPlans.length,
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
