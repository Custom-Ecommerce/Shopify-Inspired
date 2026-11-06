/**
 * Pakistan-focused E.164 phone normalization (blueprint §4.6 `phone`, §4.4).
 *
 * Pure and dependency-free so it can be shared by the Admin endpoints, orders,
 * scripts and the storefront. Accepted inputs (spaces, dashes, dots and
 * parentheses are ignored):
 *
 *   03001234567      -> +923001234567   (national, leading 0)
 *   3001234567       -> +923001234567   (national, no leading 0)
 *   923001234567     -> +923001234567   (country code, no plus)
 *   +923001234567    -> +923001234567   (already E.164)
 *   00923001234567   -> +923001234567   (international 00 prefix)
 *
 * Only Pakistani mobile numbers (`+92` followed by `3` and 9 more digits) are
 * accepted today; anything else returns `null`.
 */

const PK_MOBILE_E164 = /^\+923\d{9}$/;

/** Returns the E.164 form of a Pakistani mobile number, or `null` if it cannot be normalized. */
export function normalizePhoneE164(input: unknown): string | null {
  if (typeof input !== "string") return null;

  // Keep digits and a single leading "+"; drop every other separator.
  let value = input.trim().replace(/[\s\-().]/g, "");
  if (value === "" || /[^\d+]/.test(value)) return null;
  if (value.includes("+") && !value.startsWith("+")) return null;
  if (value.indexOf("+") !== value.lastIndexOf("+")) return null;

  if (value.startsWith("+")) {
    // already carries a country code
  } else if (value.startsWith("00")) {
    value = `+${value.slice(2)}`;
  } else if (value.startsWith("92")) {
    value = `+${value}`;
  } else if (value.startsWith("0")) {
    value = `+92${value.slice(1)}`;
  } else {
    value = `+92${value}`;
  }

  return PK_MOBILE_E164.test(value) ? value : null;
}

/** True when `input` normalizes to a valid E.164 Pakistani mobile number. */
export function isValidPhoneE164(input: unknown): boolean {
  return normalizePhoneE164(input) !== null;
}
