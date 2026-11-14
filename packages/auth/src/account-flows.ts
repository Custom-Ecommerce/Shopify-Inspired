import { consumeAuthToken, createAuthToken, type AuthTokenModelPort } from './auth-tokens';

/*
 * Sprint 4 EP-08 (D-093): password reset, email verification and email change, written once for both backends. Each
 * function takes its models and side effects as arguments, so the seller backend and the admin backend pass their own
 * database, mailer and links, and the tests pass fakes.
 *
 * None of them reveals whether an email exists: a caller answers forgot-password the same way whatever happened here,
 * and runs it after the response. Every account change clears the session cache entry (forgetSession) and, where the
 * old sessions must stop working, bumps tokenVersion.
 */

export type AccountEmailTemplate = 'password_reset' | 'password_changed' | 'email_verify' | 'email_change_verify';

export interface AccountEmail {
  template: AccountEmailTemplate;
  to: string;
  vars: Record<string, string>;
  dedupeKey?: string;
}

interface LeanQuery<T> {
  select(fields: string): LeanQuery<T>;
  lean(): PromiseLike<T>;
}

/** The part of the User model the flows use. Pass the model cast to this type. */
export interface AccountUserModelPort {
  findOne(filter: Record<string, unknown>): LeanQuery<unknown>;
  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options: { new: boolean }): LeanQuery<unknown>;
}

export interface AccountFlowDeps {
  users: AccountUserModelPort;
  tokens: AuthTokenModelPort;
  hashPassword(plain: string): Promise<string>;
  /** Queues an email; must never throw (the notification core does not). */
  sendEmail(email: AccountEmail): Promise<unknown> | void;
  /** An absolute link to a page of the app the email is for (e.g. /reset-password?token=...), or null when unset. */
  link(pathAndQuery: string): string | null;
  /** Clears the cached account of the session guard. */
  forgetSession(userId: string): void;
  /** Which role the flow is for (a seller reset never touches an admin account, and the reverse). */
  role: 'seller' | 'admin';
  appName: string;
  now?: () => Date;
}

export type AccountFlowCode = 'TOKEN_INVALID' | 'EMAIL_TAKEN';

export type AccountFlowResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; code: AccountFlowCode };

const LINK_FALLBACK = 'the link could not be built: ask the support team';

interface StoredUser {
  _id: unknown;
  name?: unknown;
  email?: unknown;
  role?: unknown;
  accountStatus?: unknown;
  emailVerifiedAt?: unknown;
  pendingEmail?: unknown;
}

const nameOf = (user: StoredUser): string => (typeof user.name === 'string' && user.name.trim() !== '' ? user.name.trim() : 'there');
const isActive = (user: StoredUser): boolean => user.accountStatus === undefined || user.accountStatus === null || user.accountStatus === 'active';
const clock = (deps: AccountFlowDeps): Date => (deps.now ? deps.now() : new Date());

/**
 * Forgot password. Only an existing, active account of the flow's role gets a link; anything else is silently nothing.
 * Run it after the response, so its timing cannot tell the caller which case it was.
 */
export async function requestPasswordReset(deps: AccountFlowDeps, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (email === '') return;
  const user = (await deps.users.findOne({ email, role: deps.role }).select('name email role accountStatus').lean()) as StoredUser | null;
  if (!user || !isActive(user)) return;
  const { raw } = await createAuthToken(deps.tokens, { userId: String(user._id), kind: 'password_reset', now: clock(deps) });
  await deps.sendEmail({
    template: 'password_reset',
    to: email,
    vars: { appName: deps.appName, customerName: nameOf(user), actionLink: deps.link('/reset-password?token=' + raw) ?? LINK_FALLBACK, validFor: '30 minutes' },
  });
}

/**
 * Reset with a token. The token is used once; the new hash is set, the lockout counters are cleared and tokenVersion is
 * bumped, so every existing session of the account stops working. An unknown, used or expired token is TOKEN_INVALID.
 */
export async function resetPassword(deps: AccountFlowDeps, rawToken: unknown, newPassword: string): Promise<AccountFlowResult<{ userId: string }>> {
  const now = clock(deps);
  const token = await consumeAuthToken(deps.tokens, rawToken, ['password_reset'], now);
  if (!token) return { ok: false, code: 'TOKEN_INVALID' };
  const passwordHash = await deps.hashPassword(newPassword);
  const user = (await deps.users
    .findOneAndUpdate(
      { _id: token.userId, role: deps.role },
      { $set: { passwordHash, loginAttempts: 0, lockUntil: null }, $inc: { tokenVersion: 1 } },
      { new: true },
    )
    .select('name email')
    .lean()) as StoredUser | null;
  deps.forgetSession(token.userId);
  if (!user) return { ok: false, code: 'TOKEN_INVALID' };
  if (typeof user.email === 'string') await sendPasswordChanged(deps, user);
  return { ok: true, userId: token.userId };
}

/** "Your password was changed" (after a reset or a change from the account page). */
export async function sendPasswordChanged(deps: AccountFlowDeps, user: StoredUser): Promise<void> {
  if (typeof user.email !== 'string' || user.email === '') return;
  await deps.sendEmail({
    template: 'password_changed',
    to: user.email,
    vars: { appName: deps.appName, customerName: nameOf(user), actionLink: deps.link('/forgot-password') ?? LINK_FALLBACK },
  });
}

/** Queues the verification email for an account (signup, resend). Older verification links stop working. */
export async function sendEmailVerification(deps: AccountFlowDeps, user: { id: string; email: string; name?: string | null }): Promise<void> {
  const { raw } = await createAuthToken(deps.tokens, { userId: user.id, kind: 'email_verify', now: clock(deps) });
  await deps.sendEmail({
    template: 'email_verify',
    to: user.email,
    vars: { appName: deps.appName, customerName: user.name?.trim() || 'there', actionLink: deps.link('/verify-email?token=' + raw) ?? LINK_FALLBACK, validFor: '24 hours' },
  });
}

/** Starts an email change: the link goes to the NEW address, and the old one stays the login until it is used. */
export async function requestEmailChange(deps: AccountFlowDeps, userId: string, rawNewEmail: string, name?: string | null): Promise<AccountFlowResult> {
  const newEmail = rawNewEmail.trim().toLowerCase();
  const taken = await deps.users.findOne({ email: newEmail }).select('_id').lean();
  if (taken) return { ok: false, code: 'EMAIL_TAKEN' };
  await deps.users.findOneAndUpdate({ _id: userId }, { $set: { pendingEmail: newEmail } }, { new: true }).select('_id').lean();
  const { raw } = await createAuthToken(deps.tokens, { userId, kind: 'email_change', newEmail, now: clock(deps) });
  await deps.sendEmail({
    template: 'email_change_verify',
    to: newEmail,
    vars: { appName: deps.appName, customerName: name?.trim() || 'there', newEmail, actionLink: deps.link('/verify-email?token=' + raw) ?? LINK_FALLBACK, validFor: '24 hours' },
  });
  return { ok: true };
}

const isDuplicateKey = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

/**
 * The link of a verification or email-change email. email_verify sets emailVerifiedAt (an already verified account is
 * simply ok). email_change re-checks that the new address is still free and swaps it in ONE write, which also marks it
 * verified and bumps tokenVersion (the login changed, so other sessions end).
 */
export async function confirmEmailToken(
  deps: AccountFlowDeps,
  rawToken: unknown,
): Promise<AccountFlowResult<{ userId: string; kind: 'email_verify' | 'email_change'; email: string | null }>> {
  const now = clock(deps);
  const token = await consumeAuthToken(deps.tokens, rawToken, ['email_verify', 'email_change'], now);
  if (!token) return { ok: false, code: 'TOKEN_INVALID' };

  if (token.kind === 'email_verify') {
    const verified = (await deps.users
      .findOneAndUpdate({ _id: token.userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: now } }, { new: true })
      .select('email')
      .lean()) as StoredUser | null;
    deps.forgetSession(token.userId);
    if (verified) return { ok: true, userId: token.userId, kind: 'email_verify', email: typeof verified.email === 'string' ? verified.email : null };
    const existing = (await deps.users.findOne({ _id: token.userId }).select('email').lean()) as StoredUser | null;
    if (!existing) return { ok: false, code: 'TOKEN_INVALID' };
    return { ok: true, userId: token.userId, kind: 'email_verify', email: typeof existing.email === 'string' ? existing.email : null };
  }

  const newEmail = token.newEmail;
  if (!newEmail) return { ok: false, code: 'TOKEN_INVALID' };
  const taken = await deps.users.findOne({ email: newEmail, _id: { $ne: token.userId } }).select('_id').lean();
  if (taken) return { ok: false, code: 'EMAIL_TAKEN' };
  try {
    const swapped = (await deps.users
      .findOneAndUpdate(
        { _id: token.userId, pendingEmail: newEmail },
        { $set: { email: newEmail, emailVerifiedAt: now, pendingEmail: null }, $inc: { tokenVersion: 1 } },
        { new: true },
      )
      .select('email')
      .lean()) as StoredUser | null;
    deps.forgetSession(token.userId);
    if (!swapped) return { ok: false, code: 'TOKEN_INVALID' };
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: false, code: 'EMAIL_TAKEN' };
    throw err;
  }
  return { ok: true, userId: token.userId, kind: 'email_change', email: newEmail };
}
