"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { NO_FAVOURITES, favouriteProductsView, loadFavouriteProducts } from "../domain/favourites";
import type { FavouritesAnswer } from "../domain/favourites";
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

const subscribeNothing = (): (() => void) => () => {};
const onClient = (): boolean => true;
const onServer = (): boolean => false;

/**
 * The cards of the Favourites page. An id whose product is no longer Live is dropped from the list for good. That happens
 * only after every request succeeded: an outage says nothing about the products, so it never prunes.
 *
 * During hydration the ids are the server's empty list, which says nothing about the browser's real list, so the page
 * stays "loading" until hydration is over and the lookup for the real ids has answered (favouriteProductsView).
 */
export function useFavouriteProducts(): UseFavouriteProductsResult {
  const store = useFavouritesStoreApi();
  const transport = useOrderTransport();
  const ids = useSyncExternalStore(store.subscribe, store.getIds, serverIds);
  // False in the server render and the hydration render, true from then on (and at once on a client-side navigation).
  const hydrated = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const [answer, setAnswer] = useState<FavouritesAnswer<ProductCardVM> | null>(null);

  useEffect(() => {
    if (!hydrated || ids.length === 0) return;
    let current = true;
    loadFavouriteProducts(transport, ids).then(
      (result) => {
        if (!current) return;
        setAnswer({ ids, status: "ok", products: result.products.map((product) => toProductCardVM(product)) });
        if (result.missing.length > 0) store.prune(result.missing);
      },
      () => {
        if (current) setAnswer({ ids, status: "unavailable", products: [] });
      },
    );
    return () => {
      current = false;
    };
  }, [hydrated, ids, store, transport]);

  // A heart taken off on this page takes the card with it at once.
  return useMemo(() => favouriteProductsView(hydrated, ids, answer), [hydrated, ids, answer]);
}
