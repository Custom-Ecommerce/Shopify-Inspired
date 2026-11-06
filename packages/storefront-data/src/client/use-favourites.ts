"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { NO_FAVOURITES, loadFavouriteProducts } from "../domain/favourites";
import { toProductCardVM } from "../view-models/product-card";
import type { ProductCardVM } from "../view-models/product-card";
import { useFavouritesStoreApi, useOrderTransport } from "./context";

export interface UseFavouritesResult {
  ids: readonly string[];
  isFavourite: (productId: string) => boolean;
  add: (productId: string) => boolean;
  remove: (productId: string) => void;
  toggle: (productId: string) => boolean;
  clear: () => void;
}

const serverIds = (): readonly string[] => NO_FAVOURITES;

/** The favourites of the storefront this component is rendered under. Empty on the server and in the first client render. */
export function useFavourites(): UseFavouritesResult {
  const store = useFavouritesStoreApi();
  const ids = useSyncExternalStore(store.subscribe, store.getIds, serverIds);
  return useMemo(
    () => ({
      ids,
      isFavourite: (productId: string) => ids.includes(productId),
      add: store.add,
      remove: store.remove,
      toggle: store.toggle,
      clear: store.clear,
    }),
    [ids, store],
  );
}

export type FavouriteProductsStatus = "loading" | "ok" | "unavailable";

export interface UseFavouriteProductsResult {
  status: FavouriteProductsStatus;
  products: ProductCardVM[];
}

/**
 * The cards of the Favourites page. An id whose product is no longer Live is dropped from the list for good. That happens
 * only after every request succeeded: an outage says nothing about the products, so it never prunes.
 */
export function useFavouriteProducts(): UseFavouriteProductsResult {
  const store = useFavouritesStoreApi();
  const transport = useOrderTransport();
  const ids = useSyncExternalStore(store.subscribe, store.getIds, serverIds);
  const [status, setStatus] = useState<FavouriteProductsStatus>("loading");
  const [products, setProducts] = useState<ProductCardVM[]>([]);

  useEffect(() => {
    let current = true;
    if (ids.length === 0) {
      setProducts([]);
      setStatus("ok");
      return;
    }
    loadFavouriteProducts(transport, ids).then(
      (result) => {
        if (!current) return;
        setProducts(result.products.map((product) => toProductCardVM(product)));
        setStatus("ok");
        if (result.missing.length > 0) store.prune(result.missing);
      },
      () => {
        if (current) setStatus("unavailable");
      },
    );
    return () => {
      current = false;
    };
  }, [ids, store, transport]);

  // A heart taken off on this page takes the card with it at once.
  const shown = useMemo(() => products.filter((product) => ids.includes(product.id)), [products, ids]);
  return { status, products: shown };
}
