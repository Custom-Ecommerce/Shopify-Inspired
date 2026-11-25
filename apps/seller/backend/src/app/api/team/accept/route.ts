import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readAccountBody } from '@/lib/account-support';
import { authenticate } from '@/lib/auth';
import { teamAcceptRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { requireSellerActor } from '@/lib/owned-store';
import { acceptInvite } from '@/lib/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/team/accept  { token } (S8-B2, D-118). The signed-in user accepts an invitation to a store's team. No store is in the request: the invite names it.
 * Order: authenticate -> seller -> parse (400 + field) -> DB -> ONE compare-and-set on { tokenHash, invited, not expired, the signed-in account's email }.
 *
 *   200 { storeId, storeName, role }
 *   400 INVITE_INVALID   the SAME neutral answer for an unknown, expired, used or wrong-account token (a wrong account does not use the token up)
 *   401 no session   403 an admin session
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const body = await readAccountBody(request, teamAcceptRequestSchema);
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await acceptInvite(ctx, body.token), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
