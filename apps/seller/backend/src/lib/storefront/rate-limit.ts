import { StorefrontHttpError } from '@/lib/storefront/errors';

/**
 * Best-effort fixed-window limiter for the public order endpoints. The counters live in this process, so
 * on a multi-instance deployment each instance enforces its own window: it slows enumeration and
 * double-submit storms, but it is not a global quota. Put a shared limiter (edge or Redis) in front for
 * a hard guarantee.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_TRACKED = 5000;

export interface RateLimitRule {
  /** Names the bucket, so create and lookup do not share a counter. */
  name: string;
  limit: number;
  windowMs: number;
}

export const ORDER_CREATE_LIMIT: RateLimitRule = { name: 'order-create', limit: 20, windowMs: 60_000 };
export const ORDER_LOOKUP_LIMIT: RateLimitRule = { name: 'order-lookup', limit: 10, windowMs: 60_000 };
export const CART_QUOTE_LIMIT: RateLimitRule = { name: 'cart-quote', limit: 60, windowMs: 60_000 };

export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Throws 429 RATE_LIMITED (with Retry-After) once the caller exceeds the rule. */
export function enforceRateLimit(rule: RateLimitRule, storeId: string, headers: Headers, now: number = Date.now()): void {
  const key = rule.name + ':' + storeId + ':' + clientIp(headers);
  let entry = windows.get(key);

  if (!entry || entry.resetAt <= now) {
    if (windows.size >= MAX_TRACKED) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      // Still full of live windows: drop the oldest rather than grow without bound.
      if (windows.size >= MAX_TRACKED) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
    }
    entry = { count: 0, resetAt: now + rule.windowMs };
    windows.set(key, entry);
  }

  entry.count += 1;
  if (entry.count > rule.limit) {
    throw new StorefrontHttpError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', {
      retryAfterSeconds: (entry.resetAt - now) / 1000,
    });
  }
}

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}
