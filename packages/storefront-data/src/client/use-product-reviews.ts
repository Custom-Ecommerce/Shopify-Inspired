"use client";

import { useEffect, useState } from "react";
import type { StorefrontProductReviews } from "../transport/types";
import { useOrderTransport } from "./context";

export interface UseProductReviewsResult {
  /** The product's approved reviews, newest first, with the average and the count. Never null: until loaded (or when loading fails) it is the empty list. */
  reviews: StorefrontProductReviews;
  isLoading: boolean;
}

const EMPTY: StorefrontProductReviews = { reviews: [], summary: { average: 0, count: 0 }, page: 1, totalPages: 0 };

/**
 * Sprint 5 EP-21.US01.T03: a product's reviews for a theme's product page. A live store's page passes `initial`, read on the server under the
 * product's cache tag, so the list is in the first paint; without it (the demo) the hook reads the list through the transport. A failure shows
 * the empty list: a page without reviews is better than a page without a product.
 */
export function useProductReviews(slug: string, initial?: StorefrontProductReviews | null): UseProductReviewsResult {
  const transport = useOrderTransport();
  const [state, setState] = useState<{ reviews: StorefrontProductReviews; isLoading: boolean }>({ reviews: initial ?? EMPTY, isLoading: initial === undefined || initial === null });

  useEffect(() => {
    if (initial !== undefined && initial !== null) {
      setState({ reviews: initial, isLoading: false });
      return;
    }
    let cancelled = false;
    setState({ reviews: EMPTY, isLoading: true });
    transport.getProductReviews(slug, 1).then(
      (loaded) => {
        if (!cancelled) setState({ reviews: loaded, isLoading: false });
      },
      () => {
        if (!cancelled) setState({ reviews: EMPTY, isLoading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [slug, transport, initial]);

  return state;
}
