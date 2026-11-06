"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";

export interface AdminFetchState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

/** A session the backend no longer accepts sends the operator back to sign in. */
export function redirectIfExpired(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401 && typeof window !== "undefined") {
    window.location.assign("/login?reason=expired");
    return true;
  }
  return false;
}

/**
 * Loads data and tracks loading and error. The previous data stays on screen while the next page loads, a stale
 * answer from an earlier request is dropped, and refetch() reloads without changing the inputs.
 */
export function useAdminFetch<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): AdminFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(fetcher);
  latest.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    latest.current(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setLoading(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        if (redirectIfExpired(err)) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Try again."));
        setLoading(false);
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, refetch };
}
