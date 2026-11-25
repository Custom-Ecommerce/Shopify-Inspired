import "server-only";

import { PREVIEW_CREDENTIAL_HEADER } from "@markaz/platform-kit/preview";
import { customDomainKey } from "@markaz/platform-kit/tenancy-host";

import { STOREFRONT_API_PREFIX, parseResponse, sellerGet } from "./client";
import { StoreNotFoundError } from "./errors";
import { StoreByKeyResponse, type StoreStatus, type StorefrontStore } from "./schemas";
import { domainResolveTag, storeResolveTag } from "./tags";

/** Store records change rarely; a purge of `store-resolve:<key>` shortcuts this. */
export const STORE_REVALIDATE_SECONDS = 300;

export type StoreLookupBy = "slug" | "handle" | "domain";

export type StoreByKey =
  /** `preview` is true when the backend accepted the preview credential. Then the store may also be pending (A-012). */
  | { kind: "active"; store: StorefrontStore; preview: boolean }
  /** The store exists but is not serving; the backend exposes only its state. */
  | { kind: "inactive"; status: Exclude<StoreStatus, "active"> };

/** Mirrors the backend's accepted key shape; anything else cannot be a store. */
const STORE_KEY_RE = /^[a-z0-9-]{3,64}$/;

export function normalizeStoreKey(key: string): string | null {
  const normalized = key.trim().toLowerCase();
  return STORE_KEY_RE.test(normalized) ? normalized : null;
}

/**
 * GET /stores/by-key/:key?by=slug|handle|domain
 *
 * `domain` (S7-B6) is a custom domain. The backend answers only for a VERIFIED one, and answers a verified-less host exactly as an unknown
 * store (404), so there is nothing to tell the two apart here. It is tagged `domain-resolve:<host>`, which the backend purges when the domain is
 * verified, changed or disconnected, and it never carries a preview token: a preview belongs to the store subdomain.
 *
 * Tagged `store-resolve:<key>`; an id-scoped tag is not available because the
 * store id is only known from the response. Throws `StoreNotFoundError` for an
 * unknown or malformed key (no request is made for the latter), plus the usual
 * unavailable / rate-limited errors.
 *
 * With a preview token the call carries it as a header and skips the data cache altogether, so a preview answer has no
 * cache entry that a live request could ever read, and the reverse.
 */
export async function fetchStoreByKey(key: string, by: StoreLookupBy, previewToken: string | null = null): Promise<StoreByKey> {
  const normalized = by === "domain" ? customDomainKey(key) : normalizeStoreKey(key);
  if (!normalized) throw new StoreNotFoundError();
  const tag = by === "domain" ? domainResolveTag(normalized) : storeResolveTag(normalized);
  // A custom host never takes a preview (host-only credentials, D-019).
  const credential = by === "domain" ? null : previewToken;

  const path = `${STOREFRONT_API_PREFIX}/stores/by-key/${encodeURIComponent(normalized)}`;
  const body = await sellerGet(
    path,
    credential === null
      ? { query: { by }, tags: [tag], revalidate: STORE_REVALIDATE_SECONDS }
      : { query: { by }, headers: { [PREVIEW_CREDENTIAL_HEADER]: credential } },
  );

  const { data, preview } = parseResponse(StoreByKeyResponse, body, "store");

  // Status-only payload: pending / suspended / archived.
  if (!("id" in data)) return { kind: "inactive", status: data.status };
  // Full DTO. The backend only sends it for active stores, or in a preview it accepted; fail closed if not.
  if (preview === true) return { kind: "active", store: data, preview: true };
  if (data.status !== "active") return { kind: "inactive", status: data.status };
  return { kind: "active", store: data, preview: false };
}
