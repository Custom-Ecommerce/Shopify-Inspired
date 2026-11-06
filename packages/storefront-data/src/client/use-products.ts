"use client";

import { useEffect, useState } from "react";
import { mockTransport } from "../transport/mock";
import type { StorefrontTransport } from "../transport/types";
import { toProductCardVM } from "../view-models/product-card";
import type { ProductCardVM } from "../view-models/product-card";

export interface UseProductsResult {
  products: ProductCardVM[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Client-side product list for theme presenters.
 * Part 1 defaults to the in-memory mock transport. Pass a stable transport instance,
 * not an inline object, so the effect does not refetch on every render.
 */
export function useProducts(transport: StorefrontTransport = mockTransport): UseProductsResult {
  const [state, setState] = useState<UseProductsResult>({
    products: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    transport.getProducts().then(
      (dtos) => {
        if (cancelled) return;
        setState({ products: dtos.map((dto) => toProductCardVM(dto)), isLoading: false, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          products: [],
          isLoading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [transport]);

  return state;
}
