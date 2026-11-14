import { createHash, randomBytes } from 'node:crypto';

/*
 * Sprint 4 EP-08 (D-093): single-use account tokens for password reset, email verification and email change.
 *
 * The raw token is 32 random bytes (base64url, 43 characters). It exists only in the emailed link: the database keeps its
 * SHA-256 hex, so a leaked database cannot be used to reset anyone. A token is looked up by that hash (an exact index match,
 * so no secret is compared character by character in code), and consumed by ONE compare-and-set on
 * { tokenHash, kind, usedAt: null, expiresAt > now }: two clicks of the same link can never both succeed.
 */

export const AUTH_TOKEN_KINDS = ['password_reset', 'email_verify', 'email_change'] as const;
export type AuthTokenKind = (typeof AUTH_TOKEN_KINDS)[number];

/** Reset links live 30 minutes; verification and email-change links 24 hours (D-093). */
export const AUTH_TOKEN_TTL_MS: Readonly<Record<AuthTokenKind, number>> = {
  password_reset: 30 * 60 * 1000,
  email_verify: 24 * 60 * 60 * 1000,
  email_change: 24 * 60 * 60 * 1000,
};

const RAW_TOKEN_BYTES = 32;
/** base64url of 32 bytes, without padding. */
const RAW_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

interface LeanQuery<T> {
  lean(): PromiseLike<T>;
}

/** The part of the AuthToken Mongoose model these functions use. Pass the model cast to this type. */
export interface AuthTokenModelPort {
  create(doc: Record<string, unknown>): PromiseLike<unknown>;
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): PromiseLike<unknown>;
  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options: { new: boolean }): LeanQuery<unknown>;
}

export interface ConsumedAuthToken {
  userId: string;
  kind: AuthTokenKind;
  newEmail: string | null;
}

export function generateRawToken(): string {
  return randomBytes(RAW_TOKEN_BYTES).toString('base64url');
}

export function hashAuthToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** True when the value has the shape of a raw token. Anything else is refused before the database is asked. */
export function isRawTokenShape(value: unknown): value is string {
  return typeof value === 'string' && RAW_TOKEN_SHAPE.test(value);
}

export interface CreateAuthTokenInput {
  userId: string;
  kind: AuthTokenKind;
  /** email_change only: the address the link confirms. */
  newEmail?: string | null;
  now?: Date;
}

/**
 * Makes a new token and returns the RAW value for the link (never store or log it). The user's older unused tokens of
 * the same kind are marked used first, so only the newest link works.
 */
export async function createAuthToken(model: AuthTokenModelPort, input: CreateAuthTokenInput): Promise<{ raw: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  await model.updateMany({ user: input.userId, kind: input.kind, usedAt: null }, { $set: { usedAt: now } });
  const raw = generateRawToken();
  const expiresAt = new Date(now.getTime() + AUTH_TOKEN_TTL_MS[input.kind]);
  await model.create({
    user: input.userId,
    kind: input.kind,
    tokenHash: hashAuthToken(raw),
    expiresAt,
    usedAt: null,
    ...(input.kind === 'email_change' && input.newEmail ? { newEmail: input.newEmail } : {}),
  });
  return { raw, expiresAt };
}

/**
 * Uses a token once. Null for a token that is unknown, of another kind, already used or expired: the caller answers
 * all of them the same way, so a guess learns nothing.
 */
export async function consumeAuthToken(
  model: AuthTokenModelPort,
  raw: unknown,
  kinds: readonly AuthTokenKind[],
  now: Date = new Date(),
): Promise<ConsumedAuthToken | null> {
  if (!isRawTokenShape(raw) || kinds.length === 0) return null;
  const row = (await model
    .findOneAndUpdate(
      { tokenHash: hashAuthToken(raw), kind: { $in: [...kinds] }, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { new: true },
    )
    .lean()) as { user?: unknown; kind?: unknown; newEmail?: unknown } | null;
  if (!row || row.user === undefined || row.user === null) return null;
  const kind = (AUTH_TOKEN_KINDS as readonly string[]).includes(String(row.kind)) ? (row.kind as AuthTokenKind) : kinds[0]!;
  return { userId: String(row.user), kind, newEmail: typeof row.newEmail === 'string' ? row.newEmail : null };
}
