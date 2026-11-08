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
 * Resolves a store by public slug or permanent internal handle.
 *
 * Wrapped in React `cache()`, so layouts, pages and `generateMetadata` that
 * call it with the same arguments during one request share a single lookup.
 * Never throws: every failure is returned as a value.
 */
export const resolveStore = cache(
  async (key: string, by: "slug" | "handle"): Promise<ResolveStoreResult> => {
    try {
      const token = await requestPreviewToken();
      const result = await fetchStoreByKey(key, by, token);
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
