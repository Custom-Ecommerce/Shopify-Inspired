import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditAccount, bumpTokenVersion, NO_STORE, readAccountBody, sellerAccountDeps, verifyCurrentPassword } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { passwordChangeRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { runAfterResponse } from '@/lib/notifications';
import { assertCan, hashPassword, sendPasswordChanged } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/users/me/password   body: { currentPassword, newPassword }   (EP-08.US04.T01)
 *
 * The new hash and tokenVersion + 1 in ONE compare-and-set: every other session ends, and THIS session gets a fresh
 * token, so the seller stays signed in. A "password changed" email is queued.
 *
 *   200 { token }   400 PASSWORD_INCORRECT { field: currentPassword } | ACCOUNT_BODY_INVALID { field }
 *   401 no session   409 SESSION_REVOKED (changed in another session meanwhile)   429 too many wrong current passwords
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'sellerAccount', ['password']);
    const body = await readAccountBody(request, passwordChangeRequestSchema);
    await requireDatabase();

    const account = await verifyCurrentPassword(ctx, body.currentPassword);
    const passwordHash = await hashPassword(body.newPassword);
    const { token } = await bumpTokenVersion(ctx, { passwordHash, loginAttempts: 0, lockUntil: null });

    await auditAccount(ctx, 'user.password_change', {});
    runAfterResponse('password_changed', () => sendPasswordChanged(sellerAccountDeps(), { _id: ctx.userId, email: account.email, name: account.name }));
    return NextResponse.json({ token }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
