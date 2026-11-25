import { NextResponse } from 'next/server';
import type { AuthRateRule } from '@markaz/auth';
import { authLimiter } from '@/lib/account-support';
import { RateLimitedError } from '@/lib/services';

/**
 * Sprint 8 (S8-B4, D-118): the per-key limit of the v1 API (S8-B5 calls it after the key is checked). The shared MongoDB counters of D-081, keyed by the KEY ID
 * (hashed into the counter key, so a counter names no key), fixed windows of one minute. A problem with the counter store never blocks a request (logged, fail
 * open, as D-081 says). No daily or per-plan cap.
 */

export const API_KEY_RATE_RULE: AuthRateRule = { name: 'api-key', limit: 120, windowMs: 60_000 };

export const apiRateLimitedBody = (retryAfterSeconds: number) => ({
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait and try again.', retryAfterSeconds },
});

/**
 * Counts one request of this key. Null when it is allowed; otherwise the 429 answer with Retry-After, ready to return.
 */
export async function limitApiKey(keyId: string, now: number = Date.now()): Promise<NextResponse | null> {
  try {
    await authLimiter.consume(API_KEY_RATE_RULE, keyId, now);
    return null;
  } catch (err) {
    if (!(err instanceof RateLimitedError)) throw err;
    const seconds = err.retryAfterSeconds;
    return NextResponse.json(apiRateLimitedBody(seconds), { status: 429, headers: { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' } });
  }
}
