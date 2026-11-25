"use client";

import { createContext, useContext } from "react";
import { DEMO_CART_STORE } from "./cart-store";
import type { CartStore } from "./cart-store";
import { DEMO_FAVOURITES_KEY, createFavouritesStore } from "../domain/favourites";
import type { FavouritesStore } from "../domain/favourites";
import { mockTransport } from "../transport/mock";
import { SILENT_TRACKER } from "../domain/analytics";
import type { StoreTracker } from "../domain/analytics";
import type { OrderTransport } from "../transport/types";

/*
 * Three contexts, all with defaults that serve the demo: fixtures for orders, a demo cart and demo favourites. A live store mounts
 * StorefrontProvider, which replaces both. Themes never see these; they call the hooks.
 */
const OrderTransportContext = createContext<OrderTransport>(mockTransport);
const CartStoreContext = createContext<CartStore>(DEMO_CART_STORE);

export const DEMO_FAVOURITES_STORE: FavouritesStore = createFavouritesStore(DEMO_FAVOURITES_KEY);
const FavouritesStoreContext = createContext<FavouritesStore>(DEMO_FAVOURITES_STORE);

const CardAvailableContext = createContext(false);
/** Cash on delivery is on unless a live store has switched it off (Sprint 4 EP-04.US03). The demo keeps it on. */
const CodAvailableContext = createContext(true);

/** Sprint 8 (S8-B6): the anonymous counters. Silent unless a live store mounts StorefrontProvider. */
const TrackerContext = createContext<StoreTracker>(SILENT_TRACKER);

export const TrackerProvider = TrackerContext.Provider;

export function useStoreTracker(): StoreTracker {
  return useContext(TrackerContext);
}

export const OrderTransportProvider = OrderTransportContext.Provider;
export const CardAvailableProvider = CardAvailableContext.Provider;
export const CodAvailableProvider = CodAvailableContext.Provider;
export const CartStoreProvider = CartStoreContext.Provider;
export const FavouritesStoreProvider = FavouritesStoreContext.Provider;

/** Whether this store can take a card payment now. False on the demo. */
export function useCardAvailable(): boolean {
  return useContext(CardAvailableContext);
}

/** Whether this store takes cash on delivery now. True on the demo. */
export function useCodAvailable(): boolean {
  return useContext(CodAvailableContext);
}

export function useOrderTransport(): OrderTransport {
  return useContext(OrderTransportContext);
}

export function useFavouritesStoreApi(): FavouritesStore {
  return useContext(FavouritesStoreContext);
}

export function useCartStoreApi(): CartStore {
  return useContext(CartStoreContext);
}
