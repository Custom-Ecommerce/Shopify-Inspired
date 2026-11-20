import { sessionTokenVersion } from './session';

/*
 * Sprint 4 EP-08.US03.T01 (D-093): every authenticated request is checked against the account, not only the login.
 * A token is refused when its user is gone, suspended or blocked, has another role, or carries an older tokenVersion
 * (a password reset, a password change or "sign out of all other devices" bumps it). The account is read through a
 * small in-process cache of at most 30 seconds; every change this platform makes to an account clears its entry, so the
 * same process reacts at once and other processes within 30 seconds.
 */

export const ACCOUNT_STATUSES = ['active', 'suspended', 'blocked'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** The most a cached account may lag behind the database. */
export const SESSION_USER_CACHE_MAX_MS = 30_000;
const CACHE_MAX_ENTRIES = 5000;

export type SessionRejectionCode = 'SESSION_REVOKED' | 'ACCOUNT_SUSPENDED';

/** A token that verified but must not be served. Routes answer 401 with the code. */
export class SessionRejectedError extends Error {
  readonly code: SessionRejectionCode;

  constructor(code: SessionRejectionCode) {
    super(code === 'ACCOUNT_SUSPENDED' ? 'This account is suspended' : 'This session is no longer valid. Sign in again.');
    this.name = 'SessionRejectedError';
    this.code = code;
  }
}

export interface SessionUserRecord {
  role: string;
  accountStatus: AccountStatus;
  tokenVersion: number;
  emailVerifiedAt: Date | null;
}

/** Reads the account fields the guard needs, or null when the user does not exist. */
export type SessionUserLoader = (userId: string) => Promise<SessionUserRecord | null>;

/** A stored user read leniently: a missing status is active and a missing tokenVersion is 0, so old accounts need no migration. */
export function toSessionUserRecord(doc: unknown): SessionUserRecord | null {
  if (doc === null || doc === undefined || typeof doc !== 'object') return null;
  const row = doc as Record<string, unknown>;
  const status = (ACCOUNT_STATUSES as readonly string[]).includes(String(row.accountStatus)) ? (row.accountStatus as AccountStatus) : 'active';
  const tv = typeof row.tokenVersion === 'number' && Number.isInteger(row.tokenVersion) && row.tokenVersion >= 0 ? row.tokenVersion : 0;
  const verified = row.emailVerifiedAt instanceof Date ? row.emailVerifiedAt : typeof row.emailVerifiedAt === 'string' ? new Date(row.emailVerifiedAt) : null;
  return { role: String(row.role ?? ''), accountStatus: status, tokenVersion: tv, emailVerifiedAt: verified && !Number.isNaN(verified.getTime()) ? verified : null };
}

/** The projection a loader should read. */
export const SESSION_USER_FIELDS = 'role accountStatus tokenVersion emailVerifiedAt';

export interface SessionGuard {
  /** The account behind a verified token, or a SessionRejectedError. */
  check(claims: { sub: string; role: string; tv?: unknown }, now?: number): Promise<SessionUserRecord>;
  /** Drops one cached account (call it after every change to that account). */
  forget(userId: string): void;
  /** Drops every cached account (tests). */
  clear(): void;
}

export function createSessionGuard(loader: SessionUserLoader, options: { ttlMs?: number } = {}): SessionGuard {
  const ttl = Math.max(0, Math.min(options.ttlMs ?? SESSION_USER_CACHE_MAX_MS, SESSION_USER_CACHE_MAX_MS));
  const cache = new Map<string, { record: SessionUserRecord; until: number }>();

  async function read(userId: string, now: number): Promise<SessionUserRecord | null> {
    const hit = cache.get(userId);
    if (hit && hit.until > now) return hit.record;
    cache.delete(userId);
    const record = await loader(userId);
    if (record && ttl > 0) {
      if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(userId, { record, until: now + ttl });
    }
    return record;
  }

  return {
    async check(claims, now = Date.now()) {
      const record = await read(claims.sub, now);
      if (!record) throw new SessionRejectedError('SESSION_REVOKED');
      if (record.accountStatus !== 'active') throw new SessionRejectedError('ACCOUNT_SUSPENDED');
      if (record.role !== claims.role) throw new SessionRejectedError('SESSION_REVOKED');
      if (sessionTokenVersion(claims) !== record.tokenVersion) throw new SessionRejectedError('SESSION_REVOKED');
      return record;
    },
    forget(userId) {
      cache.delete(userId);
    },
    clear() {
      cache.clear();
    },
  };
}
