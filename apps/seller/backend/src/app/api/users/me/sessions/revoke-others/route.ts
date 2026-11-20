import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditAccount, bumpTokenVersion, NO_STORE } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/users/me/sessions/revoke-others (EP-08.US04.T02, "Sign out of all other devices"). tokenVersion + 1, so
 * every other session's token is refused (401 SESSION_REVOKED), and THIS session gets a fresh token.
 *
 *   200 { token }   401 no session   409 SESSION_REVOKED (the account changed in another session meanwhile)
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'sellerAccount', ['sessions']);
    await requireDatabase();
    const { token } = await bumpTokenVersion(ctx);
    await auditAccount(ctx, 'user.sessions_revoked', {});
    return NextResponse.json({ token }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
