import "server-only";

import { cache } from "react";

import { fetchStoreByKey } from "@/lib/api/stores";
import {
  StoreNotActiveError,
  StoreNotFoundError,
} from "@/lib/api/errors";
import type { StorefrontStore } from "@/lib/api/schemas";
import { requestPreviewToken } from "@/lib/preview";

/**
 * Result of resolving a tenant key to a store.
 *
 * - `ok`          the store exists and is active, or this is a preview the backend
 *                 accepted. `previewToken` is set only then: it is the credential
 *                 for the transport, and must never reach a client component.
 * - `not-found`   no such store (or a key that cannot be one).
 * - `unavailable` the store exists but is not serving; `status` is its state
 *                 (`pending`, `suspended`, `archived`).
 * - `error`       the lookup itself failed (backend down, timeout, rate limit,
 *                 bad response). Not a statement about the store; callers
 *                 should not cache or treat it as "not found".
 */
export type ResolveStoreResult =
  | { outcome: "ok"; store: StorefrontStore; previewToken: string | null }
  | { outcome: "not-found" }
  | { outcome: "unavailable"; status: string }
  | { outcome: "error"; error: unknown };

/**
 * Resolves a store by public slug, permanent internal handle, or (S7-B6) custom domain.
 *
 * A key with a dot is a custom domain: a store slug and a handle never contain one (a-z, 0-9 and hyphens), so the middleware passes the custom host as the tenant key
 * and every page, route and BFF call below this function serves it exactly like the store's subdomain. The backend answers only for a VERIFIED domain, and an unknown,
 * unverified, failed or disconnected host is the same "not found" as an unknown store. A custom host never carries a preview token.
 *
 * Wrapped in React `cache()`, so layouts, pages and `generateMetadata` that
 * call it with the same arguments during one request share a single lookup.
 * Never throws: every failure is returned as a value.
 */
export const resolveStore = cache(
  async (key: string, by: "slug" | "handle" | "domain"): Promise<ResolveStoreResult> => {
    try {
      const mode = key.includes(".") ? "domain" : by;
      const token = mode === "domain" ? null : await requestPreviewToken();
      const result = await fetchStoreByKey(key, mode, token);
      if (result.kind === "active") {
        return { outcome: "ok", store: result.store, previewToken: result.preview ? token : null };
      }
      return { outcome: "unavailable", status: result.status };
    } catch (error) {
      if (error instanceof StoreNotFoundError) return { outcome: "not-found" };
      if (error instanceof StoreNotActiveError) {
        return { outcome: "unavailable", status: error.storeStatus ?? "unknown" };
      }
      return { outcome: "error", error };
    }
  },
);
