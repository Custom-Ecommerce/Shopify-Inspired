"use client";

import { ThemedNotFound } from "@/components/themed-state";
import { useTenant } from "@/context/tenant-context";

/** The store's own not-found page. It renders inside the store's layout, so the header and footer stay in place. */
export default function TenantNotFound() {
  const { effectiveTheme } = useTenant();
  return <ThemedNotFound slug={effectiveTheme.slug} />;
}
