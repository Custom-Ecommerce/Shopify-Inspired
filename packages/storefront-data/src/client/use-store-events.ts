"use client";

import { useEffect, useRef } from "react";
import { oncePerView } from "../domain/analytics";
import { useStoreTracker } from "./context";

/*
 * Sprint 8 (S8-B6): the counters a theme's pages ask for. In an effect, so rendering never waits; once per view. Outside a live store (demo, preview) the tracker
 * is silent. The visit is counted by StorefrontProvider and add-to-cart by useCart, so a theme needs these two only.
 */

/** One product_view per product shown. Null while there is no product. */
export function useProductViewEvent(slug: string | null): void {
  const tracker = useStoreTracker();
  const sent = useRef<string | null>(null);
  useEffect(() => {
    oncePerView(sent, slug, () => tracker.track("product_view", slug as string));
  }, [tracker, slug]);
}

/** One checkout_start per visit to the checkout page. */
export function useCheckoutStartEvent(): void {
  const tracker = useStoreTracker();
  const sent = useRef<string | null>(null);
  useEffect(() => {
    oncePerView(sent, "checkout", () => tracker.track("checkout_start"));
  }, [tracker]);
}
