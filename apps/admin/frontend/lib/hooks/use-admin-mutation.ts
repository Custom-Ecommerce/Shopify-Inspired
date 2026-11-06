"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { redirectIfExpired } from "@/lib/hooks/use-admin-fetch";

export interface AdminMutation<I, O> {
  run: (input: I) => Promise<O | null>;
  pending: boolean;
  error: ApiError | null;
  reset: () => void;
}

/** Runs a write. On failure it keeps the error for the form and answers null; it never throws into the UI. */
export function useAdminMutation<I, O>(action: (input: I) => Promise<O>): AdminMutation<I, O> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(
    async (input: I): Promise<O | null> => {
      setPending(true);
      setError(null);
      try {
        return await action(input);
      } catch (err) {
        if (redirectIfExpired(err)) return null;
        setError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Try again."));
        return null;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action],
  );

  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}
