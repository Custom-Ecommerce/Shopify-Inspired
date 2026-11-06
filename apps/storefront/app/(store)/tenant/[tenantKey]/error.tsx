"use client";

import { useEffect } from "react";
import { ThemedUnavailable } from "@/components/themed-state";
import { useTenant } from "@/context/tenant-context";

/**
 * A page in this store failed for a reason its route did not expect. The theme shows its own state inside the store's
 * layout, and a retry re-renders the segment. The error detail goes to the browser console, never to the shopper.
 */
export default function TenantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { effectiveTheme } = useTenant();
  useEffect(() => {
    console.error("[storefront] page error", error);
  }, [error]);

  return (
    <ThemedUnavailable slug={effectiveTheme.slug} message="Something went wrong while loading this page. Please try again." onRetry={reset} />
  );
}
