import { normalizePhoneE164, signupRequestSchema } from '@/lib/contracts';
import { issueToken, requireDatabase, requireSellerSecret, sessionUserOf } from '@/lib/accounts';
import { HttpError, handleRouteError, isDuplicateKeyError } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { hashPassword, sendEmailVerification, User } from '@/lib/services';
import { requireVerificationLink, sellerAccountDeps } from '@/lib/account-support';
import { runAfterResponse } from '@/lib/notifications';
import { captureReferral } from '@/lib/referrals';
import { enforceSignupLimits } from '@/lib/signup-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/signup. Creates a seller account (no store yet) and returns a session token. Limited per client address and per email (lib/signup-limit.ts). */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, signupRequestSchema);
    if (!body.ok) return body.response;

    requireSellerSecret();
    await requireDatabase();
    // Sprint 5 EP-11.US04.T04: before the account exists, so nobody is left with an account and no way to confirm it.
    requireVerificationLink();

    const email = body.data.email.toLowerCase();
    // SB-F1: before the account is looked up or written (429 RATE_LIMITED with Retry-After).
    await enforceSignupLimits(request.headers, email);
    if (await User.exists({ email })) {
      throw new HttpError(409, 'An account with this email already exists');
    }
    const passwordHash = await hashPassword(body.data.password);
    // S8-B5: optional, used by the self-referral check; anything that is not a Pakistani mobile is ignored.
    const phone = normalizePhoneE164(body.data.phone);

    try {
      const user = await User.create({
        name: body.data.name,
        email,
        role: 'seller',
        store: null,
        passwordHash,
        loginAttempts: 0,
        accountStatus: 'active',
        tokenVersion: 0,
        emailVerifiedAt: null,
        lockUntil: null,
        ...(phone === null ? {} : { phone }),
      });
      // S8-B5: silent whatever happens; the answer below is the same with or without a code.
      await captureReferral({ id: String(user._id), email, phone, name: body.data.name }, body.data.ref ?? new URL(request.url).searchParams.get('ref'));
      const token = await issueToken(String(user._id), 'seller');
      // Sprint 4 EP-08.US02.T01: the verification email is queued after the response; signup never waits on it.
      const account = { id: String(user._id), email, name: body.data.name };
      runAfterResponse('email_verify', () => sendEmailVerification(sellerAccountDeps(), account));
      return Response.json({ success: true, token, user: { ...sessionUserOf(user), emailVerified: false } }, { status: 201 });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new HttpError(409, 'An account with this email already exists');
      }
      throw err;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
