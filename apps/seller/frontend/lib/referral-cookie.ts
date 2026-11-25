import { normalizeReferralCode } from "@markaz/contracts/referral";

/**
 * Sprint 8 (S8-B5, D-118): how the signup page remembers ?ref=<code> until the account is made, also when the visitor leaves for their email and comes back. A
 * short-lived cookie holding ONLY the code (7 days, SameSite=Lax, readable by the page: it is no secret). Cleared once signup completes. Pure: no document, no
 * window; the caller passes the strings in and writes the result.
 */

export const REFERRAL_COOKIE = "markaz-ref";
export const REFERRAL_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

/** The code of ?ref= in an address's query string, or null. */
export function refFromSearch(search: string): string | null {
  try {
    return normalizeReferralCode(new URLSearchParams(search).get("ref"));
  } catch {
    return null;
  }
}

/** The code kept in a cookie string (document.cookie), or null. */
export function refFromCookies(cookies: string): string | null {
  for (const part of cookies.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === REFERRAL_COOKIE) return normalizeReferralCode(part.slice(at + 1));
  }
  return null;
}

/** The value to assign to document.cookie to remember a code. */
export function refCookie(code: string, secure: boolean): string {
  return `${REFERRAL_COOKIE}=${code}; Path=/; Max-Age=${REFERRAL_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The code a signup sends: the one in the address first (the newest link wins), else the remembered one. */
export function signupRef(search: string, cookies: string): string | null {
  return refFromSearch(search) ?? refFromCookies(cookies);
}
