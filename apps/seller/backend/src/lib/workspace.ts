/* patch_session_fix: shared workspace helpers (kept out of route files; Next only allows route exports there) */
import { STORE_SLUG_MAX_LENGTH, STORE_SLUG_MIN_LENGTH } from '@markaz/platform-kit/reservation';
import { listActiveMemberships } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import type { AuthContext } from '@/lib/auth';
import { seedStoreDemoData } from '@/lib/demo-data';
import { DEFAULT_ENV_STORE_LIMIT, parseEnvStoreLimit, positiveWhole, resolveStoreLimit, type EffectiveStoreLimit } from '@/lib/effective-limits';
import { PlanLimitError } from '@/lib/http';
import { assertWithinPlan, canCheckPlans, loadEffectivePlan } from '@/lib/plan';
import { connectSellerDb } from '@/lib/mongo';
import { readPlatformSettings } from '@/lib/platform-settings';
import { ensureSellerMirror } from '@/lib/seller-mirror';
import { Store, User } from '@/lib/services';
import { newStoreStorefront } from '@/lib/store-defaults';

export type WorkspaceStoreStatus = 'pending' | 'active' | 'suspended' | 'archived';

const STORE_SUMMARY_SELECT = [
  'name',
  'slug',
  'internalHandle',
  'status',
  'suspensionReason',
  'suspensionNote',
  'suspendedAt',
  'logoUrl',
  'activeTheme',
  'domain',
  'customDomainStatus',
  'billing.stripeOnboardingStatus',
  'billing.stripeChargesEnabled',
].join(' ');

const KNOWN_STATUSES = ['pending', 'active', 'suspended', 'archived'];

/** The environment's store limit (SELLER_MAX_STORES, else 3): the LAST step of the precedence in lib/effective-limits.ts. */
export function maxStoresPerSeller(): number {
  return parseEnvStoreLimit(process.env.SELLER_MAX_STORES) ?? DEFAULT_ENV_STORE_LIMIT;
}

/**
 * Sprint 6 EP-12.US02.T01 (D-118): the store limit of one seller and where it comes from: the seller's own override, then the plan limit
 * (EP-14; no plan input yet, so none applies), then the platform setting maxStoresPerSeller, then the environment. The pure rule is
 * resolveStoreLimit; this only gathers its inputs. readPlatformSettings never throws.
 */
export async function effectiveStoreLimitFor(override: unknown, planLimit?: unknown): Promise<EffectiveStoreLimit> {
  const settings = await readPlatformSettings();
  return resolveStoreLimit({ override, planLimit, platformMax: settings.maxStoresPerSeller, envMax: process.env.SELLER_MAX_STORES });
}

/** A plan with no store limit shows as this many in the workspace (the largest override an admin can set). */
export const UNLIMITED_STORES_SHOWN = 1000;

/**
 * Sprint 6 EP-14 (D-118): the store limit WITH the seller's plan: the override first, then the effective plan's store limit (a plan with no
 * store limit is unlimited, shown as UNLIMITED_STORES_SHOWN), then the platform setting and the environment. Where plans cannot be checked
 * (a unit test with no connection) the plan step is skipped, as before.
 */
export async function storeLimitWithPlan(ownerId: string, override: unknown): Promise<EffectiveStoreLimit> {
  const planLimit = canCheckPlans() ? ((await loadEffectivePlan(ownerId)).limits.stores ?? UNLIMITED_STORES_SHOWN) : undefined;
  return effectiveStoreLimitFor(override, planLimit);
}

/**
 * Sprint 4 EP-04.US06 (D-094, CO-26): every new store starts pending, in every environment. It goes live through the
 * readiness checklist and POST /api/stores/:id/go-live. The SELLER_NEW_STORE_STATUS shortcut and the "active outside
 * production" default are gone.
 */
export function newStoreStatus(): WorkspaceStoreStatus {
  return 'pending';
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, STORE_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return base.length >= STORE_SLUG_MIN_LENGTH ? base : 'store';
}

const SLUG_SUFFIX_LENGTH = 4;

/** The base cut so that '-' and the suffix still fit the limit, for the retry after a slug is taken. */
export function slugWithSuffix(base: string, suffix: string): string {
  const room = STORE_SLUG_MAX_LENGTH - 1 - SLUG_SUFFIX_LENGTH;
  return base.slice(0, room).replace(/-+$/g, '') + '-' + suffix.slice(0, SLUG_SUFFIX_LENGTH);
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value !== '' ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The WorkspaceStore wire shape the dashboard expects (id, not _id; nulls for absent optionals). */
export function toWorkspaceStore(doc: Record<string, unknown>, role: 'owner' | 'manager' | 'staff' | 'support' = 'owner') {
  const billing = (doc.billing ?? null) as { stripeOnboardingStatus?: unknown; stripeChargesEnabled?: unknown } | null;
  const status = typeof doc.status === 'string' && KNOWN_STATUSES.includes(doc.status) ? doc.status : 'pending';
  return {
    id: String(doc._id),
    // Sprint 8 (S8-B2): the signed-in user's role in this store.
    role,
    name: String(doc.name ?? ''),
    slug: String(doc.slug ?? ''),
    internalHandle: str(doc.internalHandle),
    status: status as WorkspaceStoreStatus,
    suspensionReason: str(doc.suspensionReason),
    suspensionNote: str(doc.suspensionNote),
    suspendedAt: iso(doc.suspendedAt),
    logoUrl: str(doc.logoUrl),
    activeTheme: str(doc.activeTheme),
    domain: str(doc.domain),
    customDomainStatus: str(doc.customDomainStatus) ?? 'unset',
    billing: billing
      ? {
          stripeOnboardingStatus: str(billing.stripeOnboardingStatus),
          stripeChargesEnabled: typeof billing.stripeChargesEnabled === 'boolean' ? billing.stripeChargesEnabled : null,
        }
      : null,
  };
}

async function connect(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

interface AccountDoc {
  name?: string | null;
  email?: string;
  accountStatus?: string | null;
  storeLimitOverride?: unknown;
}

async function loadAccount(
  ctx: AuthContext,
): Promise<{ id: string; name: string | null; email: string; accountStatus: 'active' | 'suspended'; limitOverride: unknown }> {
  const user = (await User.findById(ctx.userObjectId).select('name email accountStatus storeLimitOverride').lean()) as AccountDoc | null;
  if (!user) throw new HttpError(401, 'Invalid or expired session');
  return {
    id: ctx.userId,
    name: user.name ?? null,
    email: String(user.email ?? ''),
    accountStatus: user.accountStatus === 'suspended' ? 'suspended' : 'active',
    // Kept apart from the public fields: the seller's own response never carries the override itself.
    limitOverride: user.storeLimitOverride,
  };
}

async function loadStores(ctx: AuthContext) {
  const docs = (await Store.find({ owner: ctx.userObjectId })
    .select(STORE_SUMMARY_SELECT)
    .sort({ createdAt: 1 })
    .lean()) as unknown as Record<string, unknown>[];
  const owned = docs.map((doc) => toWorkspaceStore(doc));
  // Sprint 8 (S8-B2): the stores where the user is an ACTIVE member, after their own, each with the role they hold. An invited, disabled or removed member sees none.
  const memberships = await listActiveMemberships(ctx);
  if (memberships.length === 0) return { owned, all: owned };
  const ownedIds = new Set(owned.map((store) => store.id));
  const wanted = memberships.filter((entry) => !ownedIds.has(entry.storeId));
  if (wanted.length === 0) return { owned, all: owned };
  const memberDocs = (await Store.find({ _id: { $in: wanted.map((entry) => entry.storeId) } })
    .select(STORE_SUMMARY_SELECT)
    .sort({ createdAt: 1 })
    .lean()) as unknown as Record<string, unknown>[];
  const roleOf = new Map(wanted.map((entry) => [entry.storeId, entry.role]));
  const member = memberDocs.map((doc) => toWorkspaceStore(doc, roleOf.get(String(doc._id)) ?? 'staff'));
  return { owned, all: [...owned, ...member] };
}

/** GET /api/workspace payload: the user, a summary of every owned store, and limits. */
export async function loadWorkspace(ctx: AuthContext) {
  await connect();
  const [account, loaded] = await Promise.all([loadAccount(ctx), loadStores(ctx)]);
  const stores = loaded.all;
  const { limitOverride, ...user } = account;
  const { limit: max, source } = await storeLimitWithPlan(ctx.userId, limitOverride);
  return {
    user,
    stores,
    // The store limit counts the stores the user OWNS; a store they only work in is not theirs.
    limits: { used: loaded.owned.length, max, canCreate: user.accountStatus !== 'suspended' && loaded.owned.length < max, source },
  };
}

export type ProvisionResult =
  | { ok: true; store: { id: string; name: string; slug: string; status: string } }
  | { ok: false; status: number; body: Record<string, unknown> };

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** POST /api/workspace/stores: creates a store owned by the signed-in seller. */
export async function provisionStore(ctx: AuthContext, rawName: unknown): Promise<ProvisionResult> {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 2 || name.length > 80) {
    return { ok: false, status: 400, body: { error: 'Store name must be between 2 and 80 characters.', code: 'INVALID_BODY' } };
  }

  await connect();
  const account = await loadAccount(ctx);
  if (account.accountStatus === 'suspended') {
    return { ok: false, status: 403, body: { error: 'Account suspended.', code: 'ACCOUNT_SUSPENDED' } };
  }

  const used = await Store.countDocuments({ owner: ctx.userObjectId });
  if (positiveWhole(account.limitOverride) !== null || !canCheckPlans()) {
    // An admin's override for this seller (it wins over the plan), or no plan to check: the limit of Sprint 6 EP-12, answered as before.
    const { limit: max, source } = await effectiveStoreLimitFor(account.limitOverride);
    if (used >= max) {
      return { ok: false, status: 409, body: { error: 'Store limit reached.', code: 'STORE_LIMIT_REACHED', used, max, source } };
    }
  } else {
    // Sprint 6 EP-14 (D-118): the plan's store limit. After the account checks above, before the write: 403 PLAN_LIMIT_REACHED.
    try {
      await assertWithinPlan({ kind: 'stores', ownerId: ctx.userId });
    } catch (err) {
      if (err instanceof PlanLimitError) return { ok: false, status: 403, body: { error: err.message, ...err.body } };
      throw err;
    }
  }

  const base = slugify(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : slugWithSuffix(base, Math.random().toString(36).slice(2).padEnd(SLUG_SUFFIX_LENGTH, '0'));
    try {
      const created = await Store.create({ name, slug, owner: ctx.userObjectId, status: newStoreStatus(), storefront: newStoreStorefront() });
      await seedStoreDemoData(String(created._id));
      // Sprint 5 EP-11.US04.T02 (D-106): the `sellers` mirror row, best effort, never fails the creation.
      await ensureSellerMirror(ctx.userObjectId);
      return {
        ok: true,
        store: { id: String(created._id), name: String(created.name), slug: String(created.slug), status: String(created.status) },
      };
    } catch (err) {
      if (isDuplicateKey(err)) continue;
      throw err;
    }
  }
  return { ok: false, status: 409, body: { error: 'That store name is taken. Try another.', code: 'SLUG_TAKEN' } };
}
