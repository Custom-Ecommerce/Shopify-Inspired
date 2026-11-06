import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Store, User } from '@markaz/db-schemas';
import { authenticate } from '@/lib/auth';
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
      .select('name email role store accountStatus lockUntil createdAt updatedAt')
      .lean();

    if (!user) throw new HttpError(401, 'Invalid or expired session');
    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      throw new HttpError(403, 'Account is locked');
    }

    /* patch_session_fix: the dashboard reads user.stores (owned store ids) and user.accountStatus */
    const ownedStores = (await Store.find({ owner: ctx.userObjectId }).select("_id").sort({ createdAt: 1 }).lean()) as unknown as Array<{ _id: unknown }>;
    const accountStatus = (user as { accountStatus?: string | null }).accountStatus === "suspended" ? "suspended" : "active";

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
