/**
 * Timing-safe shared-secret comparison for `/api/revalidate`.
 *
 * Both values are hashed first, so the comparison runs over fixed-length
 * digests and the secret's length is not revealed by timing. Uses `node:crypto`,
 * so this module is server-only (Node runtime).
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length === 0 || expected.length === 0) return false;
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
