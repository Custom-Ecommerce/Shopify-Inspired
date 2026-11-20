import { createHash, timingSafeEqual } from 'node:crypto';

/** A cron secret shorter than this is treated as not set, so a weak value cannot open the route. */
export const CRON_SECRET_MIN_LENGTH = 16;

interface HeaderSource {
  get(name: string): string | null;
}

/** The secret a scheduler sent: the x-cron-secret header, or Authorization: Bearer <secret>. */
export function presentedCronSecret(headers: HeaderSource): string | null {
  const direct = headers.get('x-cron-secret');
  if (direct !== null && direct.trim() !== '') return direct.trim();
  const auth = headers.get('authorization');
  const bearer = auth === null ? null : /^bearer\s+(\S+)\s*$/i.exec(auth);
  return bearer?.[1] ?? null;
}

/**
 * True only when the expected secret is set (and long enough) and the request carries exactly it. The comparison is in
 * constant time over SHA-256 digests, so neither the content nor the length of the secret leaks through timing.
 */
export function cronSecretMatches(headers: HeaderSource, expected: string | undefined): boolean {
  const secret = (expected ?? '').trim();
  if (secret.length < CRON_SECRET_MIN_LENGTH) return false;
  const presented = presentedCronSecret(headers);
  if (presented === null) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
