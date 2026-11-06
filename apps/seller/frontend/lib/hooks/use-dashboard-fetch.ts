"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

import { useActiveStoreId } from "@/lib/dashboard-context";
import { useDashboardData } from "@/lib/dashboard-data-context";
import { DashboardApiError, ERROR_CODES, type ErrorCode } from "@/lib/error-codes";

/**
 * Where each §6.8 code sends the user. `/stores` is the workspace portal and
 * `/` the resolver (Phase 6B). A redirect to the page we are already on is
 * suppressed (see `maybeRedirect`) and the error is shown inline instead.
 */
export const DASHBOARD_ROUTES = {
  login: "/login?clear=1",
  stores: "/stores",
  root: "/",
} as const;

interface FetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** The §6.8 code (or upstream code) of the last failure; `null` when none. */
  errorCode: ErrorCode | string | null;
  /** True for BACKEND_OFFLINE — show an offline state with `refetch` as the retry. */
  offline: boolean;
  refetch: () => void;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ERROR = "An error occurred";

/** Default messages for codes where a hard-coded fallback is better than a bare status. */
function messageFor(status: number, code: string | null, serverMessage?: string): string {
  if (serverMessage) return serverMessage;
  switch (code) {
    case ERROR_CODES.BACKEND_OFFLINE: return "Could not reach the backend. Please try again.";
    case ERROR_CODES.STORE_FORBIDDEN: return "You do not have access to this store.";
    case ERROR_CODES.UNAUTHENTICATED: return "Your session has expired. Please sign in again.";
    default: return `Request failed with status ${status}`;
  }
}

/** Reads `{ error, code, details }` from a failed response into a typed error. */
async function toApiError(res: Response): Promise<DashboardApiError> {
  let serverMessage: string | undefined;
  let code: string | null = null;
  let details: unknown;
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null) {
      const rec = body as Record<string, unknown>;
      if (typeof rec.error === "string") serverMessage = rec.error;
      else if (typeof rec.message === "string") serverMessage = rec.message;
      if (typeof rec.code === "string") code = rec.code;
      details = rec.details;
    }
  } catch {
    /* non-JSON error body */
  }
  // Infer when the body carried no code (e.g. an HTML 502 from a proxy in front).
  if (!code) {
    if (res.status === 401) code = ERROR_CODES.UNAUTHENTICATED;
    else if (res.status === 502 || res.status === 503 || res.status === 504) code = ERROR_CODES.BACKEND_OFFLINE;
  }
  return new DashboardApiError(messageFor(res.status, code, serverMessage), res.status, code, details);
}

/**
 * `GET url` against the dashboard API with the active store injected.
 *
 * - Sends `x-store-id` (from `DashboardContext`) on every request.
 * - Cache keys include the store id, so a store switch can never show another store's data.
 * - Maps the §6.8 error codes:
 *     UNAUTHENTICATED (401)                  → full navigation to /login?clear=1
 *     STORE_FORBIDDEN (403)                  → /stores
 *     STORE_CONTEXT_REQUIRED (400)           → "/" resolver
 *     STORE_PENDING | SUSPENDED | ARCHIVED   → `errorCode` set (banner state), server message shown
 *     BACKEND_OFFLINE (502)                  → `offline: true`, retry via `refetch`
 *     STORE_MISMATCH (400)                   → logged as a bug, message shown
 *     anything else                          → the server's own message
 */
export const useDashboardFetch = <T,>(url: string): FetchResult<T> => {
  const router = useRouter();
  const storeId = useActiveStoreId();
  const { cache, setCacheData, refreshTrigger, setIsRefreshing } = useDashboardData();

  // `storeId` is part of the key: same URL on another store is a different entry.
  const cacheKey = url ? `${storeId}::${url}` : "";

  const initialCache = cacheKey ? cache[cacheKey] : undefined;
  const initialIsValid = initialCache && Date.now() - initialCache.timestamp < CACHE_TTL_MS;

  const [data, setData] = useState<T | null>(initialIsValid ? initialCache.data : null);
  const [loading, setLoading] = useState<boolean>(!initialIsValid);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | string | null>(null);
  const [localTrigger, setLocalTrigger] = useState(0);

  const lastTrigger = useRef(refreshTrigger + localTrigger);

  const refetch = useCallback(() => {
    setLocalTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!url) return;

    const currentTrigger = refreshTrigger + localTrigger;
    const isForced = currentTrigger !== lastTrigger.current;
    lastTrigger.current = currentTrigger;

    const cached = cache[cacheKey];
    const isValidCache = cached && Date.now() - cached.timestamp < CACHE_TTL_MS;

    // Not a forced refresh and cache is valid → use it.
    if (!isForced && isValidCache) {
      setData(cached.data);
      setLoading(false);
      setError(null);
      setErrorCode(null);
      return;
    }

    let mounted = true;
    const controller = new AbortController();

    const maybeRedirect = (target: string, hard = false) => {
      // Never redirect to the page we're already on (defensive: avoids a loop).
      if (window.location.pathname === target.split("?")[0]) return;
      if (hard) window.location.assign(target);
      else router.push(target);
    };

    const handleApiError = (err: DashboardApiError) => {
      setError(err.message || DEFAULT_ERROR);
      setErrorCode(err.code);

      switch (err.code) {
        case ERROR_CODES.UNAUTHENTICATED:
          // Hard navigation: `?clear=1` makes the middleware drop the stale cookie.
          maybeRedirect(DASHBOARD_ROUTES.login, true);
          break;
        case ERROR_CODES.STORE_FORBIDDEN:
          maybeRedirect(DASHBOARD_ROUTES.stores);
          break;
        case ERROR_CODES.STORE_CONTEXT_REQUIRED:
          maybeRedirect(DASHBOARD_ROUTES.root);
          break;
        case ERROR_CODES.STORE_MISMATCH:
          console.error("[useDashboardFetch] STORE_MISMATCH — client/store context out of sync", { url, storeId });
          break;
        default:
          // STORE_PENDING / STORE_SUSPENDED / STORE_ARCHIVED, BACKEND_OFFLINE and
          // everything else surface through `errorCode` + the server's message.
          break;
      }
    };

    if (isForced) setIsRefreshing(true);
    if (!cached?.data) setLoading(true);
    setError(null);
    setErrorCode(null);

    const headers: Record<string, string> = { "x-store-id": storeId };

    fetch(url, { headers, signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw await toApiError(res);
        return res.json();
      })
      .then((json) => {
        if (!mounted) return;
        if (json && typeof json === "object" && "error" in json && json.error) {
          const code = typeof json.code === "string" ? json.code : null;
          handleApiError(new DashboardApiError(String(json.error), 200, code, json.details));
        } else {
          setData(json);
          setCacheData(cacheKey, json);
        }
      })
      .catch((err: unknown) => {
        if (!mounted || (err instanceof DOMException && err.name === "AbortError")) return;
        if (err instanceof DashboardApiError) {
          handleApiError(err);
        } else {
          // fetch() itself rejected → the browser could not reach the Next server.
          setError(err instanceof Error && err.message ? err.message : DEFAULT_ERROR);
          setErrorCode(ERROR_CODES.BACKEND_OFFLINE);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
          if (isForced) setIsRefreshing(false);
        }
      });

    return () => {
      mounted = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, refreshTrigger, localTrigger]);

  const offline = errorCode === ERROR_CODES.BACKEND_OFFLINE;

  return { data, loading, error, errorCode, offline, refetch };
};
