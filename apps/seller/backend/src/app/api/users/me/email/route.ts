import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auditAccount, NO_STORE, readAccountBody, sellerAccountDeps, verifyCurrentPassword } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { ACCOUNT_CODES, emailChangeRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { assertCan, requestEmailChange } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/users/me/email   body: { password, newEmail }   (EP-08.US04.T01)
 *
 * Needs the current password. Stores the new address as pendingEmail and emails a confirmation link to the NEW address
 * (24 hours, single use). The old email stays the login until the link is used (POST /api/auth/verify-email), which
 * re-checks the new address is free and swaps it in one write.
 *
 *   200 { ok: true, pendingEmail }   400 PASSWORD_INCORRECT | ACCOUNT_BODY_INVALID { field }   409 EMAIL_TAKEN
 *   401 no session   429 too many wrong current passwords
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'sellerAccount', ['email']);
    const body = await readAccountBody(request, emailChangeRequestSchema);
    await requireDatabase();

    const account = await verifyCurrentPassword(ctx, body.password);
    if (account.email.toLowerCase() === body.newEmail) {
      throw new HttpError(400, 'This is already your email address.', ACCOUNT_CODES.BODY_INVALID, 'newEmail');
    }
    const result = await requestEmailChange(sellerAccountDeps(), ctx.userId, body.newEmail, account.name);
    if (!result.ok) throw new HttpError(409, 'This email address is already used by another account.', ACCOUNT_CODES.EMAIL_TAKEN, 'newEmail');

    await auditAccount(ctx, 'user.email_change_requested', {});
    return NextResponse.json({ ok: true, pendingEmail: body.newEmail }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
