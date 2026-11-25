import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { handleRouteError, HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { buildReferralOverview } from '@/lib/referrals';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/referrals (S8-B5). The signed-in owner's own referral code (made on first read), share link and referrals. Owner only (referrals.read): the store named
 * is only the proof of the role; the data is the account's. A referred seller sees nothing here about having been referred. Read only.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'referrals');
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only a seller has referrals');
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    await resolveOwnedStoreId(request, ctx, null, { capability: 'referrals.read' });
    return NextResponse.json(await buildReferralOverview(ctx.userObjectId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
