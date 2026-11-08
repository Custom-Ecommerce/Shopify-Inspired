"use client";

import { createContext, useContext } from "react";
import { DEMO_CART_STORE } from "./cart-store";
import type { CartStore } from "./cart-store";
import { DEMO_FAVOURITES_KEY, createFavouritesStore } from "../domain/favourites";
import type { FavouritesStore } from "../domain/favourites";
import { mockTransport } from "../transport/mock";
import type { OrderTransport } from "../transport/types";

/*
 * Three contexts, all with defaults that serve the demo: fixtures for orders, a demo cart and demo favourites. A live store mounts
 * StorefrontProvider, which replaces both. Themes never see these; they call the hooks.
 */
const OrderTransportContext = createContext<OrderTransport>(mockTransport);
const CartStoreContext = createContext<CartStore>(DEMO_CART_STORE);

export const DEMO_FAVOURITES_STORE: FavouritesStore = createFavouritesStore(DEMO_FAVOURITES_KEY);
const FavouritesStoreContext = createContext<FavouritesStore>(DEMO_FAVOURITES_STORE);

export const OrderTransportProvider = OrderTransportContext.Provider;
export const CartStoreProvider = CartStoreContext.Provider;
export const FavouritesStoreProvider = FavouritesStoreContext.Provider;

export function useOrderTransport(): OrderTransport {
  return useContext(OrderTransportContext);
}

export function useFavouritesStoreApi(): FavouritesStore {
  return useContext(FavouritesStoreContext);
}

export function useCartStoreApi(): CartStore {
  return useContext(CartStoreContext);
}
