"use client";

import { useEffect, useState } from "react";
import { mockTransport } from "../transport/mock";
import type { StorefrontTransport } from "../transport/types";
import { toProductDetailVM } from "../view-models/product-detail";
import type { ProductDetailVM } from "../view-models/product-detail";

export interface UseProductResult {
  /** Null while loading, on error, or when no product has this slug. Check isLoading and error. */
  product: ProductDetailVM | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Client-side product detail for theme presenters, keyed by slug.
 * Part 2 defaults to the in-memory mock transport.
 */
export function useProduct(slug: string, transport: StorefrontTransport = mockTransport): UseProductResult {
  const [state, setState] = useState<UseProductResult>({ product: null, isLoading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    // Reset on slug change so a previous product never flashes under a new URL.
    setState((prev) =>
      prev.isLoading && prev.product === null && prev.error === null
        ? prev
        : { product: null, isLoading: true, error: null },
    );

    transport.getProduct(slug).then(
      (dto) => {
        if (cancelled) return;
        setState({ product: dto ? toProductDetailVM(dto) : null, isLoading: false, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          product: null,
          isLoading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [slug, transport]);

  return state;
}
