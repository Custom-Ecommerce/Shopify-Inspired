import mongoose from 'mongoose';
import { resolveClientIp } from '@markaz/platform-kit/client-ip';
import { verifiedClientAddress } from '@markaz/platform-kit/signed-client-address';
import { isDuplicateKeyError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { RateLimitCounter } from '@/lib/services';
import { StorefrontHttpError } from '@/lib/storefront/errors';

/**
 * Fixed-window limiter for the public storefront endpoints (D-081). Counters live in MongoDB, so every backend instance
 * counts the same window, and windows are aligned to the clock, so every instance agrees when one ends. A limiter
 * problem never stops a customer: anything that goes wrong here is logged and the request carries on.
 */
export interface RateLimitRule {
  /** Names the bucket, so each endpoint has its own counter. */
  name: string;
  limit: number;
  windowMs: number;
}

export const ORDER_CREATE_LIMIT: RateLimitRule = { name: 'order-create', limit: 20, windowMs: 60_000 };
/** Order lookup and customer tracking count together (D-069), so two endpoints do not double a client's guesses. */
export const ORDER_LOOKUP_LIMIT: RateLimitRule = { name: 'order-lookup', limit: 10, windowMs: 60_000 };
export const CART_QUOTE_LIMIT: RateLimitRule = { name: 'cart-quote', limit: 60, windowMs: 60_000 };
export const FAVOURITES_LIMIT: RateLimitRule = { name: 'favourites', limit: 30, windowMs: 60_000 };
/** Quotes that carry a code, on top of the quote's own limit. A cart with a code is quoted again on every change, so this leaves room for that. */
export const DISCOUNT_CHECK_LIMIT: RateLimitRule = { name: 'discount-check', limit: 20, windowMs: 60_000 };

export interface RateLimitStore {
  /** Adds one to the key's counter, creating it if needed, and returns the new count. */
  hit(key: string, expiresAt: Date): Promise<number>;
}

/** The limiter gives up on the store after this long, and the customer goes through. */
const STORE_TIMEOUT_MS = 1000;
const STORE_QUERY_MAX_MS = 800;
/** Counters outlive their window by a little, so a clock difference between instances cannot restart a count. */
const EXPIRY_GRACE_MS = 60_000;

let ttlIndex: Promise<unknown> | null = null;

/** The connection is opened with bufferCommands off, which also stops Mongoose building indexes by itself. */
function ensureTtlIndex(): void {
  ttlIndex ??= RateLimitCounter.createIndexes().catch((err: unknown) => {
    ttlIndex = null;
    console.error('[rate-limit] could not create the expiry index', { message: messageOf(err) });
  });
}

async function increment(key: string, expiresAt: Date): Promise<number> {
  const row = await RateLimitCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true, maxTimeMS: STORE_QUERY_MAX_MS },
  ).lean();
  if (typeof row?.count !== 'number') throw new Error('the counter update returned no count');
  return row.count;
}

const mongoStore: RateLimitStore = {
  async hit(key, expiresAt) {
    await connectSellerDb();
    if (mongoose.connection.readyState !== 1) throw new Error('the database connection is not open');
    ensureTtlIndex();
    try {
      return await increment(key, expiresAt);
    } catch (err) {
      // Two first requests of a window can both try to insert. The loser's retry finds the document and counts.
      if (!isDuplicateKeyError(err)) throw err;
      return increment(key, expiresAt);
    }
  },
};

let store: RateLimitStore = mongoStore;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}

function withinTime<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the store did not answer in time')), STORE_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

let warnedNoAddress = false;

/** An address the storefront signed comes first. Anything else, a forged signature included, falls to the usual resolver. */
function clientKey(headers: Headers, storeId: string): string {
  const address = verifiedClientAddress(headers, process.env.CLIENT_ADDRESS_SIGNING_SECRET ?? '', storeId) ?? resolveClientIp(headers, process.env);
  if (address !== null) return address;
  if (!warnedNoAddress) {
    warnedNoAddress = true;
    console.warn('[rate-limit] no client address could be read, so clients share one limit. Set TRUSTED_PROXY_HOPS or TRUSTED_CLIENT_IP_HEADER.');
  }
  return 'unknown';
}

/** Throws 429 RATE_LIMITED (with Retry-After) once the caller exceeds the rule. Must be awaited. */
export async function enforceRateLimit(rule: RateLimitRule, storeId: string, headers: Headers, now: number = Date.now()): Promise<void> {
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const windowEnd = windowStart + rule.windowMs;
  const key = rule.name + ':' + storeId + ':' + clientKey(headers, storeId) + ':' + windowStart;

  let count: number;
  try {
    count = await withinTime(store.hit(key, new Date(windowEnd + EXPIRY_GRACE_MS)));
  } catch (err) {
    console.error('[rate-limit] store error, allowing the request', { rule: rule.name, storeId, message: messageOf(err) });
    return;
  }

  if (count > rule.limit) {
    throw new StorefrontHttpError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', {
      retryAfterSeconds: (windowEnd - now) / 1000,
    });
  }
}

/** Test hook: starts from empty counters, kept in this process so a unit test needs no database. */
export function resetRateLimits(): void {
  const counters = new Map<string, number>();
  store = {
    hit: async (key) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return count;
    },
  };
}
