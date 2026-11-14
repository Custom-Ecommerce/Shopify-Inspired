import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Store, User } from '@markaz/db-schemas';
import { auditAccount, NO_STORE, readAccountBody } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { accountProfileUpdateSchema } from '@/lib/contracts';
import { assertCan } from '@/lib/services';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/users/me
 *
 * Returns the authenticated caller's own account. This is a self-read with a fixed
 * projection: passwordHash and login-attempt counters are never selected.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    const user = await User.findById(ctx.userObjectId)
      .select('name email role store accountStatus lockUntil createdAt updatedAt phone pendingEmail emailVerifiedAt')
      .lean();

    if (!user) throw new HttpError(401, 'Invalid or expired session');
    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      throw new HttpError(403, 'Account is locked');
    }

    /* patch_session_fix: the dashboard reads user.stores (owned store ids) and user.accountStatus */
    const ownedStores = (await Store.find({ owner: ctx.userObjectId }).select("_id").sort({ createdAt: 1 }).lean()) as unknown as Array<{ _id: unknown }>;
    const stored = (user as { accountStatus?: string | null }).accountStatus;
    const accountStatus = stored === 'suspended' || stored === 'blocked' ? stored : 'active';
    const extra = user as { phone?: string | null; pendingEmail?: string | null; emailVerifiedAt?: Date | null };

    return NextResponse.json(
      {
        user: {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          store: user.store ? String(user.store) : null,
          stores: ownedStores.map((s) => String(s._id)),
          accountStatus,
          // Sprint 4 EP-08: the dashboard shows the verify banner and the account page from these.
          emailVerified: Boolean(extra.emailVerifiedAt),
          phone: extra.phone ?? null,
          pendingEmail: extra.pendingEmail ?? null,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/users/me   body: { name?, phone? }   (EP-08.US04.T01)
 *
 * The seller's own name and phone (the shared Pakistani mobile rule; an empty phone clears it). One write, read back.
 *
 *   200 { user: { id, name, phone } }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not a seller
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'sellerAccount', ['name']);
    const body = await readAccountBody(request, accountProfileUpdateSchema);
    assertCan(ctx.actor, 'update', 'sellerAccount', Object.keys(body));
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.phone !== undefined) set.phone = body.phone;
    const updated = (await User.findOneAndUpdate({ _id: ctx.userObjectId, role: 'seller' }, { $set: set }, { new: true, runValidators: true })
      .select('name phone')
      .lean()) as { _id: unknown; name?: unknown; phone?: unknown } | null;
    if (!updated) throw new HttpError(401, 'Invalid or expired session');

    await auditAccount(ctx, 'user.profile', { fields: Object.keys(set) });
    return NextResponse.json(
      { user: { id: String(updated._id), name: String(updated.name ?? ''), phone: typeof updated.phone === 'string' ? updated.phone : null } },
      { headers: NO_STORE },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

