import { createHash } from 'node:crypto';

/*
 * Sprint 4 EP-08: the account-route limits on the shared MongoDB counters (D-081, the RateLimitCounter collection the
 * storefront limiter uses). Fixed windows aligned to the clock, so every instance agrees. The subject (an email, an IP,
 * a user id) is hashed into the key, so no address is stored in a counter. A store problem never blocks a person: it is
 * logged and the request goes through (fail open, as D-081 says).
 */

export interface AuthRateRule {
  name: string;
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Login failures per account (email) and per IP (EP-08.US05.T01). */
export const LOGIN_ACCOUNT_RULE: AuthRateRule = { name: 'login-account', limit: 10, windowMs: 15 * MINUTE };
export const LOGIN_IP_RULE: AuthRateRule = { name: 'login-ip', limit: 30, windowMs: 15 * MINUTE };
/** Forgot password: 5 per hour per IP and 3 per hour per email (EP-08.US01.T04). */
export const FORGOT_IP_RULE: AuthRateRule = { name: 'forgot-ip', limit: 5, windowMs: HOUR };
export const FORGOT_EMAIL_RULE: AuthRateRule = { name: 'forgot-email', limit: 3, windowMs: HOUR };
/** Reset password: 10 per hour per IP. */
export const RESET_IP_RULE: AuthRateRule = { name: 'reset-ip', limit: 10, windowMs: HOUR };
/** Resend the verification email: 3 per hour per user (EP-08.US02.T01). */
export const RESEND_VERIFY_RULE: AuthRateRule = { name: 'resend-verify', limit: 3, windowMs: HOUR };

/** Counters outlive their window a little, so a clock difference between instances cannot restart a count. */
const EXPIRY_GRACE_MS = MINUTE;

export interface RateCounterStore {
  /** Adds one and returns the new count. */
  increment(key: string, expiresAt: Date): Promise<number>;
  /** The current count (0 when there is none). */
  read(key: string): Promise<number>;
  remove(key: string): Promise<void>;
}

/** Thrown by a route when a limit is reached. Routes answer 429 with Retry-After. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many attempts. Please wait and try again.');
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export interface RateWindow {
  key: string;
  windowEnd: number;
  retryAfterSeconds: number;
}

export function rateWindow(rule: AuthRateRule, subject: string, now: number): RateWindow {
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const windowEnd = windowStart + rule.windowMs;
  const digest = createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 32);
  return { key: 'auth:' + rule.name + ':' + digest + ':' + windowStart, windowEnd, retryAfterSeconds: (windowEnd - now) / 1000 };
}

export type RateLog = (line: string, detail: Record<string, unknown>) => void;

const defaultLog: RateLog = (line, detail) => console.error(line, detail);

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

export interface AuthRateLimiter {
  /** Counts one use and throws RateLimitedError when the count passes the limit. */
  consume(rule: AuthRateRule, subject: string, now?: number): Promise<void>;
  /** Throws RateLimitedError when the count has already reached the limit; counts nothing. */
  assertBelow(rule: AuthRateRule, subject: string, now?: number): Promise<void>;
  /** Counts one failure (login). */
  record(rule: AuthRateRule, subject: string, now?: number): Promise<void>;
  /** Forgets the current window of a subject (a successful login clears its account counter). */
  reset(rule: AuthRateRule, subject: string, now?: number): Promise<void>;
}

export function createAuthRateLimiter(getStore: () => RateCounterStore, log: RateLog = defaultLog): AuthRateLimiter {
  return {
    async consume(rule, subject, now = Date.now()) {
      const w = rateWindow(rule, subject, now);
      let count: number;
      try {
        count = await getStore().increment(w.key, new Date(w.windowEnd + EXPIRY_GRACE_MS));
      } catch (err) {
        log('[auth-rate-limit] store error, allowing the request', { rule: rule.name, message: messageOf(err) });
        return;
      }
      if (count > rule.limit) throw new RateLimitedError(w.retryAfterSeconds);
    },
    async assertBelow(rule, subject, now = Date.now()) {
      const w = rateWindow(rule, subject, now);
      let count: number;
      try {
        count = await getStore().read(w.key);
      } catch (err) {
        log('[auth-rate-limit] store error, allowing the request', { rule: rule.name, message: messageOf(err) });
        return;
      }
      if (count >= rule.limit) throw new RateLimitedError(w.retryAfterSeconds);
    },
    async record(rule, subject, now = Date.now()) {
      const w = rateWindow(rule, subject, now);
      try {
        await getStore().increment(w.key, new Date(w.windowEnd + EXPIRY_GRACE_MS));
      } catch (err) {
        log('[auth-rate-limit] could not count a failure', { rule: rule.name, message: messageOf(err) });
      }
    },
    async reset(rule, subject, now = Date.now()) {
      const w = rateWindow(rule, subject, now);
      try {
        await getStore().remove(w.key);
      } catch (err) {
        log('[auth-rate-limit] could not clear a counter', { rule: rule.name, message: messageOf(err) });
      }
    },
  };
}

interface CounterQuery {
  lean(): PromiseLike<unknown>;
}

/** The part of the RateLimitCounter model the Mongo store uses. */
export interface RateCounterModelPort {
  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>): CounterQuery;
  findOne(filter: Record<string, unknown>): CounterQuery;
  deleteOne(filter: Record<string, unknown>): PromiseLike<unknown>;
}

const QUERY_MAX_MS = 800;

/** The MongoDB store. `ready` connects and says whether the connection is open; a closed one fails (and the limiter fails open). */
export function mongoRateCounterStore(model: RateCounterModelPort, ready: () => Promise<boolean>): RateCounterStore {
  const open = async (): Promise<void> => {
    if (!(await ready())) throw new Error('the database connection is not open');
  };
  const increment = async (key: string, expiresAt: Date): Promise<number> => {
    const row = (await model
      .findOneAndUpdate({ _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, new: true, maxTimeMS: QUERY_MAX_MS })
      .lean()) as { count?: unknown } | null;
    if (typeof row?.count !== 'number') throw new Error('the counter update returned no count');
    return row.count;
  };
  return {
    async increment(key, expiresAt) {
      await open();
      try {
        return await increment(key, expiresAt);
      } catch (err) {
        // Two first hits of a window can both insert; the loser's retry finds the document and counts.
        if ((err as { code?: unknown } | null)?.code !== 11000) throw err;
        return increment(key, expiresAt);
      }
    },
    async read(key) {
      await open();
      const row = (await model.findOne({ _id: key }).lean()) as { count?: unknown } | null;
      return typeof row?.count === 'number' ? row.count : 0;
    },
    async remove(key) {
      await open();
      await model.deleteOne({ _id: key });
    },
  };
}

/** An in-process store for tests (and for a single dev process). */
export function memoryRateCounterStore(): RateCounterStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async increment(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async read(key) {
      return counts.get(key) ?? 0;
    },
    async remove(key) {
      counts.delete(key);
    },
  };
}
