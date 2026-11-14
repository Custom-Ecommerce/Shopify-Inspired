/* patch_session_fix: shared workspace helpers (kept out of route files; Next only allows route exports there) */
import { STORE_SLUG_MAX_LENGTH, STORE_SLUG_MIN_LENGTH } from '@markaz/platform-kit/reservation';
import { HttpError } from '@/lib/http';
import type { AuthContext } from '@/lib/auth';
import { seedStoreDemoData } from '@/lib/demo-data';
import { connectSellerDb } from '@/lib/mongo';
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

export function maxStoresPerSeller(): number {
  const n = Number.parseInt(process.env.SELLER_MAX_STORES ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
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
export function toWorkspaceStore(doc: Record<string, unknown>) {
  const billing = (doc.billing ?? null) as { stripeOnboardingStatus?: unknown; stripeChargesEnabled?: unknown } | null;
  const status = typeof doc.status === 'string' && KNOWN_STATUSES.includes(doc.status) ? doc.status : 'pending';
  return {
    id: String(doc._id),
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
}

async function loadAccount(ctx: AuthContext): Promise<{ id: string; name: string | null; email: string; accountStatus: 'active' | 'suspended' }> {
  const user = (await User.findById(ctx.userObjectId).select('name email accountStatus').lean()) as AccountDoc | null;
  if (!user) throw new HttpError(401, 'Invalid or expired session');
  return {
    id: ctx.userId,
    name: user.name ?? null,
    email: String(user.email ?? ''),
    accountStatus: user.accountStatus === 'suspended' ? 'suspended' : 'active',
  };
}

async function loadStores(ctx: AuthContext) {
  const docs = (await Store.find({ owner: ctx.userObjectId })
    .select(STORE_SUMMARY_SELECT)
    .sort({ createdAt: 1 })
    .lean()) as unknown as Record<string, unknown>[];
  return docs.map(toWorkspaceStore);
}

/** GET /api/workspace payload: the user, a summary of every owned store, and limits. */
export async function loadWorkspace(ctx: AuthContext) {
  await connect();
  const [user, stores] = await Promise.all([loadAccount(ctx), loadStores(ctx)]);
  const max = maxStoresPerSeller();
  return {
    user,
    stores,
    limits: { used: stores.length, max, canCreate: user.accountStatus !== 'suspended' && stores.length < max },
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
  const max = maxStoresPerSeller();
  if (used >= max) {
    return { ok: false, status: 409, body: { error: 'Store limit reached.', code: 'STORE_LIMIT_REACHED', used, max } };
  }

  const base = slugify(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : slugWithSuffix(base, Math.random().toString(36).slice(2).padEnd(SLUG_SUFFIX_LENGTH, '0'));
    try {
      const created = await Store.create({ name, slug, owner: ctx.userObjectId, status: newStoreStatus(), storefront: newStoreStorefront() });
      await seedStoreDemoData(String(created._id));
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
