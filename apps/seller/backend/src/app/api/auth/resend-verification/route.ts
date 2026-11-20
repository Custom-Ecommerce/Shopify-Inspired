import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authLimiter, NO_STORE, sellerAccountDeps } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { runAfterResponse } from '@/lib/notifications';
import { assertCan, RESEND_VERIFY_RULE, sendEmailVerification, User } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/resend-verification (signed in; EP-08.US02.T01). Sends a new verification link (the older one stops
 * working). A verified account gets { sent: false } and nothing is sent.
 *
 *   200 { sent: boolean }   401 no session   429 RATE_LIMITED (Retry-After): 3 per hour per account
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'sellerAccount');
    await requireDatabase();
    const user = (await User.findById(ctx.userObjectId).select('name email emailVerifiedAt').lean()) as {
      name?: unknown;
      email?: unknown;
      emailVerifiedAt?: unknown;
    } | null;
    if (!user) throw new HttpError(401, 'Invalid or expired session');
    if (user.emailVerifiedAt) return NextResponse.json({ sent: false }, { headers: NO_STORE });

    await authLimiter.consume(RESEND_VERIFY_RULE, ctx.userId);
    const account = { id: ctx.userId, email: String(user.email ?? ''), name: typeof user.name === 'string' ? user.name : null };
    if (account.email !== '') runAfterResponse('email_verify', () => sendEmailVerification(sellerAccountDeps(), account));
    return NextResponse.json({ sent: true }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
