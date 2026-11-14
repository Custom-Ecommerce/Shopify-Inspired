import { signupRequestSchema } from '@/lib/contracts';
import { issueToken, requireDatabase, requireSellerSecret, sessionUserOf } from '@/lib/accounts';
import { HttpError, handleRouteError, isDuplicateKeyError } from '@/lib/http';
import { parseBody } from '@/lib/placeholder';
import { hashPassword, sendEmailVerification, User } from '@/lib/services';
import { sellerAccountDeps } from '@/lib/account-support';
import { runAfterResponse } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/signup. Creates a seller account (no store yet) and returns a session token. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, signupRequestSchema);
    if (!body.ok) return body.response;

    requireSellerSecret();
    await requireDatabase();

    const email = body.data.email.toLowerCase();
    if (await User.exists({ email })) {
      throw new HttpError(409, 'An account with this email already exists');
    }
    const passwordHash = await hashPassword(body.data.password);

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
      });
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
