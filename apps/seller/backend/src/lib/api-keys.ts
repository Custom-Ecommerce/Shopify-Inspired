import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Sprint 8 (S8-B4, D-118): API keys for the read-only v1 API (S8-B5 builds the endpoints). Pure: no database, no clock but the one passed in, nothing logged.
 *
 * A key reads "mkz_live_<prefix>_<secret>": prefix is 8 hex characters (public, shown to the owner, used to find the row), secret is 32 random bytes in base64url.
 * The database holds the prefix and the SHA-256 hex of the secret; the secret itself is never stored, logged, audited or put in an error. Checking a key:
 *
 *   - parseApiKey never throws; anything that is not exactly a key is null;
 *   - an unknown prefix, a wrong secret, a malformed or missing header and a revoked key are ONE answer (the same 401 body), and each takes the same path:
 *     one lookup and one constant-time comparison (a dummy stands in when there is nothing to look up or compare), so the time tells nothing;
 *   - a good key that lacks the scope of the endpoint is 403.
 */

export const API_KEY_PREFIX_TAG = 'mkz_live';
const SECRET_BYTES = 32;
const KEY_SHAPE = /^mkz_live_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;
/** The prefix a request with no usable key is looked up under: not a prefix any key can have. */
const DUMMY_PREFIX = '--------';
const DUMMY_HASH = createHash('sha256').update('mkz-no-such-key', 'utf8').digest('hex');

export interface GeneratedApiKey {
  /** The full key, to be shown ONCE. */
  token: string;
  prefix: string;
  /** What is stored: the SHA-256 hex of the secret part. */
  hash: string;
}

export function hashApiSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { token: API_KEY_PREFIX_TAG + '_' + prefix + '_' + secret, prefix, hash: hashApiSecret(secret) };
}

/** What the owner sees of a key: its public part. */
export const publicApiKeyPrefix = (prefix: string): string => API_KEY_PREFIX_TAG + '_' + prefix;

/** The parts of a presented key, or null. Never throws, whatever it is given. */
export function parseApiKey(value: unknown): { prefix: string; secret: string } | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  const match = KEY_SHAPE.exec(value);
  return match === null ? null : { prefix: match[1]!, secret: match[2]! };
}

/** The key of an "Authorization: Bearer <key>" header, or null. */
export function bearerKeyOf(header: unknown): string | null {
  if (typeof header !== 'string' || header.length > 300) return null;
  const match = /^Bearer[ ]+([^ ]+)[ ]*$/i.exec(header);
  return match === null ? null : match[1]!;
}

/** Constant-time comparison of the hash of `secret` with a stored hex hash. A stored value that is not 64 hex characters never matches. */
export function secretMatches(secret: string, storedHash: unknown): boolean {
  const actual = Buffer.from(hashApiSecret(secret), 'hex');
  const usable = typeof storedHash === 'string' && /^[0-9a-f]{64}$/.test(storedHash);
  const expected = Buffer.from(usable ? (storedHash as string) : DUMMY_HASH, 'hex');
  // Both buffers are 32 bytes: timingSafeEqual requires equal lengths.
  const same = timingSafeEqual(actual, expected);
  return usable && same;
}

/** A stored key as the check reads it. */
export interface ApiKeyRow {
  _id: unknown;
  store: unknown;
  hash?: unknown;
  scopes?: unknown;
  revokedAt?: unknown;
}

export interface CheckedApiKey {
  id: string;
  storeId: string;
  scopes: string[];
}

/** The error bodies of the v1 API: { error: { code, message } }. Nothing in them depends on what was sent. */
export const API_UNAUTHORIZED_BODY = Object.freeze({ error: Object.freeze({ code: 'UNAUTHORIZED', message: 'Missing or invalid API key.' }) });
export const API_FORBIDDEN_BODY = Object.freeze({ error: Object.freeze({ code: 'FORBIDDEN_SCOPE', message: 'This API key does not have the scope for this request.' }) });

export type ApiKeyCheck =
  | { ok: true; status: 200; key: CheckedApiKey }
  | { ok: false; status: 401; body: typeof API_UNAUTHORIZED_BODY }
  | { ok: false; status: 403; body: typeof API_FORBIDDEN_BODY };

export interface ApiKeyCheckDeps {
  /** The row with this prefix (its hash included), or null. Asked exactly once per check. */
  findByPrefix: (prefix: string) => Promise<ApiKeyRow | null>;
}

const unauthorized = (): ApiKeyCheck => ({ ok: false, status: 401, body: API_UNAUTHORIZED_BODY });

/**
 * Checks the Authorization header of a v1 request for one scope. A database failure is thrown to the caller (it must answer 503, never "invalid key"). The
 * revocation is read from the row on every call, so a revoked key fails at once.
 */
export async function checkApiKey(authorization: unknown, scope: string, deps: ApiKeyCheckDeps): Promise<ApiKeyCheck> {
  const parsed = parseApiKey(bearerKeyOf(authorization));
  // One lookup and one comparison on every path, so a malformed, unknown, wrong or revoked key all take the same steps.
  const row = await deps.findByPrefix(parsed?.prefix ?? DUMMY_PREFIX);
  const matches = secretMatches(parsed?.secret ?? '', row?.hash);
  const revoked = row !== null && row.revokedAt !== null && row.revokedAt !== undefined;
  if (parsed === null || row === null || !matches || revoked) return unauthorized();
  const scopes = Array.isArray(row.scopes) ? row.scopes.filter((value): value is string => typeof value === 'string') : [];
  if (!scopes.includes(scope)) return { ok: false, status: 403, body: API_FORBIDDEN_BODY };
  return { ok: true, status: 200, key: { id: String(row._id), storeId: String(row.store), scopes } };
}
