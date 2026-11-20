import { timingSafeEqual } from 'node:crypto';
import { normalizePhoneE164 } from '@/lib/contracts';

/*
 * Sprint 5 EP-10.US01 (D-108): the one place an order's phone is compared and keyed. The rule itself is normalizePhoneE164 from
 * @markaz/contracts (there is no second normaliser); this file only adds the constant-time comparison the order lookup and
 * tracking routes share (they each had a private copy of samePhone) and the key an order is stored under.
 */

/** Both sides are E.164, so equal-length strings: compared without leaking where they differ. */
export function samePhone(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The phone as stored on an older order may be a local format, so it is normalised first. Returns the normalised stored phone
 * when it is the same number as `given` (already E.164), or null when it is not, or when the stored value is not a phone.
 */
export function matchOrderPhone(storedPhone: unknown, given: string): string | null {
  const stored = normalizePhoneE164(typeof storedPhone === 'string' ? storedPhone : '');
  return stored !== null && samePhone(stored, given) ? stored : null;
}

/** Order.phoneKey: the normalized phone, or undefined (the field is left absent) when the phone is missing or not a mobile number. */
export function phoneKeyOf(phone: unknown): string | undefined {
  return normalizePhoneE164(typeof phone === 'string' ? phone : '') ?? undefined;
}
