/**
 * Phase 6B — the `/s/[storeId]/…` URL contract (Blueprint §6.1, §6.6).
 *
 * Client-safe (no `server-only`): imported by server pages, client components
 * and the store switcher. The path is the single source of truth for the
 * active store, so EVERY dashboard link and `router.push` must be built with
 * these helpers (or the `useStoreHref()` hook) — never a bare `/orders`.
 */

export const STORE_ROUTE_PREFIX = "/s";

/** `/s/<storeId>` — the store's overview page. */
export function storeBasePath(storeId: string): string {
  return `${STORE_ROUTE_PREFIX}/${encodeURIComponent(storeId)}`;
}

/**
 * Builds a store-scoped URL from a store-relative path.
 *
 *   storeHref("42")                       → "/s/42"
 *   storeHref("42", "/orders")            → "/s/42/orders"
 *   storeHref("42", "/orders?status=x")   → "/s/42/orders?status=x"
 *   storeHref("42", "?foo=1")             → "/s/42?foo=1"
 */
export function storeHref(storeId: string, path: string = "/"): string {
  const base = storeBasePath(storeId);
  if (path === "" || path === "/") return base;
  if (path.startsWith("?")) return `${base}${path}`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Splits `/s/<id>/rest…` into `{ storeId, rest }`; `null` when not a store path. */
export function parseStorePath(pathname: string): { storeId: string; rest: string } | null {
  const match = /^\/s\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  let storeId = match[1];
  try {
    storeId = decodeURIComponent(storeId);
  } catch {
    /* keep the raw segment */
  }
  return { storeId, rest: match[2] ?? "" };
}

/**
 * Where the store switcher sends the user: the SAME top-level section under the
 * new store. Detail/sub routes (`/orders/[id]`, `/products/new`, …) collapse to
 * their section's list, because ids belong to the store being left (§6.6).
 */
export function switchTargetHref(newStoreId: string, currentRest: string): string {
  const section = currentRest.split("/").filter(Boolean)[0];
  return storeHref(newStoreId, section ? `/${section}` : "/");
}
