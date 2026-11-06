"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ThemedUnavailable } from "@/components/themed-state";

/** The demo's error boundary. Same behaviour as a live store's: the theme's state, a retry, and detail in the console only. */
export default function DemoError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { themeSlug } = useParams<{ themeSlug: string }>();
  useEffect(() => {
    console.error("[storefront] demo page error", error);
  }, [error]);

  return (
    <ThemedUnavailable slug={themeSlug} message="Something went wrong while loading this page. Please try again." onRetry={reset} />
  );
}
