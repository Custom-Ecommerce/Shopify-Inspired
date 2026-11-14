/**
 * Signed requests between the platform's own backends (D-026). The admin backend signs, the seller backend verifies, and
 * both use this one definition, so the two can never disagree about what is signed.
 *
 *   signature = HMAC-SHA256(secret, METHOD \n path?query \n timestamp \n adminId \n sha256(body)), lowercase hex
 *
 * Server code only: it uses node:crypto.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_SIGNATURE_HEADER = "x-markaz-signature";
export const INTERNAL_TIMESTAMP_HEADER = "x-markaz-timestamp";
/** The operator acting. It is signed, so a captured request cannot be replayed under another name. */
export const INTERNAL_ADMIN_HEADER = "x-admin-id";

export const INTERNAL_SECRET_MIN_LENGTH = 32;
/** A request older than this, or this far ahead of the receiver's clock, is refused. */
export const INTERNAL_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

const SIGNATURE = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^[0-9]{1,16}$/;
/** 1 to 64 visible characters. No spaces or line breaks, so an id cannot change the lines that are signed. */
const ADMIN_ID = /^[\x21-\x7e]{1,64}$/;

export function isInternalAdminId(value: unknown): value is string {
  return typeof value === "string" && ADMIN_ID.test(value);
}

export interface InternalRequestParts {
  method: string;
  /** Path and query exactly as sent, for example /api/internal/moderation/products?page=2. */
  path: string;
  /** Epoch milliseconds, as the decimal string that travels in the header. */
  timestamp: string;
  adminId: string;
  /** The exact body that travels, or an empty string. */
  body: string;
}

export function signInternalRequest(secret: string, parts: InternalRequestParts): string {
  const bodyHash = createHash("sha256").update(parts.body, "utf8").digest("hex");
  const canonical = [parts.method.toUpperCase(), parts.path, parts.timestamp, parts.adminId, bodyHash].join("\n");
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

/** The headers of an outgoing request. `now` is injectable for tests. */
export function internalRequestHeaders(
  secret: string,
  parts: Omit<InternalRequestParts, "timestamp">,
  now: number = Date.now(),
): Record<string, string> {
  const timestamp = String(Math.trunc(now));
  return {
    [INTERNAL_TIMESTAMP_HEADER]: timestamp,
    [INTERNAL_ADMIN_HEADER]: parts.adminId,
    [INTERNAL_SIGNATURE_HEADER]: signInternalRequest(secret, { ...parts, timestamp }),
  };
}

export interface InternalVerification extends Omit<InternalRequestParts, "timestamp" | "adminId"> {
  secret: string;
  timestamp: string | null;
  adminId: string | null;
  signature: string | null;
  now?: number;
  /** A shorter limit than INTERNAL_SIGNATURE_MAX_AGE_MS, for a signature that is used at once. */
  maxAgeMs?: number;
}

/** True only for a fresh, untouched request. Never throws, and the signatures are compared in constant time. */
export function verifyInternalSignature(input: InternalVerification): boolean {
  const { secret, timestamp, adminId, signature, method, path, body } = input;
  if (timestamp === null || signature === null || !isInternalAdminId(adminId)) return false;
  if (!TIMESTAMP.test(timestamp) || !SIGNATURE.test(signature)) return false;
  if (Math.abs((input.now ?? Date.now()) - Number(timestamp)) > (input.maxAgeMs ?? INTERNAL_SIGNATURE_MAX_AGE_MS)) return false;

  const expected = Buffer.from(signInternalRequest(secret, { method, path, timestamp, adminId, body }), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
