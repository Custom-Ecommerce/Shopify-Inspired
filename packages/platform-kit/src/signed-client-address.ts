import { cleanAddress } from "./client-ip";
import {
  INTERNAL_SECRET_MIN_LENGTH,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
  verifyInternalSignature,
} from "./internal-signature";

/**
 * The shopper's address as the storefront's BFF vouches for it. A public backend cannot tell the BFF from anyone else by
 * looking at x-forwarded-for, so the BFF signs the address with a secret only the two of them hold. Server code only.
 *
 * What is signed: the address, the store and the time. A signature for one store is no use on another, and an old one has
 * expired. The body is not part of it, because the limiter runs before the body is read.
 */
export const SIGNED_CLIENT_ADDRESS_HEADER = "x-markaz-client-address";

/** Much shorter than the signature's general limit: the BFF signs immediately before it calls. */
export const SIGNED_CLIENT_ADDRESS_MAX_AGE_MS = 60 * 1000;

const METHOD = "CLIENT-ADDRESS";
const scopeOf = (storeId: string): string => "/stores/" + storeId;

/** The headers for one call to the backend, or none when there is no usable secret or address. `now` is for tests. */
export function signedClientAddressHeaders(
  secret: string,
  storeId: string,
  address: string | null,
  now: number = Date.now(),
): Record<string, string> {
  const clean = cleanAddress(address);
  if (clean === null || secret.length < INTERNAL_SECRET_MIN_LENGTH) return {};
  const timestamp = String(Math.trunc(now));
  return {
    [SIGNED_CLIENT_ADDRESS_HEADER]: clean,
    [INTERNAL_TIMESTAMP_HEADER]: timestamp,
    [INTERNAL_SIGNATURE_HEADER]: signInternalRequest(secret, { method: METHOD, path: scopeOf(storeId), timestamp, adminId: clean, body: "" }),
  };
}

/** The vouched address, or null when it is missing, forged, altered, for another store, or too old. */
export function verifiedClientAddress(headers: Headers, secret: string, storeId: string, now: number = Date.now()): string | null {
  if (secret.length < INTERNAL_SECRET_MIN_LENGTH) return null;
  const address = headers.get(SIGNED_CLIENT_ADDRESS_HEADER);
  const genuine = verifyInternalSignature({
    secret,
    method: METHOD,
    path: scopeOf(storeId),
    body: "",
    adminId: address,
    timestamp: headers.get(INTERNAL_TIMESTAMP_HEADER),
    signature: headers.get(INTERNAL_SIGNATURE_HEADER),
    now,
    maxAgeMs: SIGNED_CLIENT_ADDRESS_MAX_AGE_MS,
  });
  return genuine ? cleanAddress(address) : null;
}
