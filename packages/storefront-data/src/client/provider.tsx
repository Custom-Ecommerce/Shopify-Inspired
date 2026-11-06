"use client";

import React, { useMemo } from "react";
import { createStorefrontCartStore, DEMO_CART_STORE } from "./cart-store";
import { CartStoreProvider, DEMO_FAVOURITES_STORE, FavouritesStoreProvider, OrderTransportProvider } from "./context";
import { createFavouritesStore, favouritesKey } from "../domain/favourites";
import { createBffTransport } from "../transport/remote";
import { createMockTransport, mockTransport } from "../transport/mock";
import type { MockFixtures } from "../transport/mock";
import type { OrderTransport } from "../transport/types";

/**
 * Mounts a storefront's client data. With a store key, the cart is kept for that store and orders go through the
 * same-origin BFF. Without one, the storefront runs on the demo cart and fixtures. A live store's layout mounts this
 * once, with the store's id as the key.
 */
export function StorefrontProvider({
  storeKey,
  demoFixtures,
  children,
}: {
  storeKey?: string;
  /** A theme's own demo catalogue. Orders placed in the demo are checked against it. Ignored for a live store. */
  demoFixtures?: MockFixtures;
  children: React.ReactNode;
}) {
  const cart = useMemo(
    () => (storeKey ? createStorefrontCartStore("markaz-cart:" + storeKey) : DEMO_CART_STORE),
    [storeKey],
  );
  const favourites = useMemo(() => (storeKey ? createFavouritesStore(favouritesKey(storeKey)) : DEMO_FAVOURITES_STORE), [storeKey]);
  const hasDemoFixtures = Boolean(demoFixtures);
  const transport = useMemo<OrderTransport>(
    () => (storeKey ? createBffTransport() : demoFixtures ? createMockTransport(demoFixtures) : mockTransport),
    // Keyed on presence: the fixtures are static, and a new object identity must not drop the demo's in-memory orders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeKey, hasDemoFixtures],
  );

  return (
    <OrderTransportProvider value={transport}>
      <CartStoreProvider value={cart}>
        <FavouritesStoreProvider value={favourites}>{children}</FavouritesStoreProvider>
      </CartStoreProvider>
    </OrderTransportProvider>
  );
}
/* @theme-integration-patch:provider */
