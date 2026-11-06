"use client";

import { useCallback } from "react";
import { useActiveStoreId } from "@/lib/dashboard-context";

/**
 * `fetch` with the active store injected as `x-store-id` (Blueprint §6.4 step 2).
 *
 * For one-shot calls (mutations, uploads, downloads) that don't go through
 * `useDashboardFetch`. Without the header the proxy can only resolve a store
 * implicitly (single-store + `MULTISTORE_IMPLICIT_DEFAULT`) and otherwise
 * answers 400 `STORE_CONTEXT_REQUIRED`.
 *
 * Accepts the same arguments as `fetch`; an explicit `x-store-id` in `init`
 * wins. Safe with `FormData` bodies (no content-type is set here).
 */
export function useStoreFetch(): (input: string, init?: RequestInit) => Promise<Response> {
  const storeId = useActiveStoreId();
  return useCallback(
    (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("x-store-id")) headers.set("x-store-id", storeId);
      return fetch(input, { ...init, headers });
    },
    [storeId],
  );
}
