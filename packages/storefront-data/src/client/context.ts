"use client";

import { createContext, useContext } from "react";
import { DEMO_CART_STORE } from "./cart-store";
import type { CartStore } from "./cart-store";
import { mockTransport } from "../transport/mock";
import type { OrderTransport } from "../transport/types";

/*
 * Two contexts, both with defaults that serve the demo: fixtures for orders and a demo cart. A live store mounts
 * StorefrontProvider, which replaces both. Themes never see these; they call the hooks.
 */
const OrderTransportContext = createContext<OrderTransport>(mockTransport);
const CartStoreContext = createContext<CartStore>(DEMO_CART_STORE);

export const OrderTransportProvider = OrderTransportContext.Provider;
export const CartStoreProvider = CartStoreContext.Provider;

export function useOrderTransport(): OrderTransport {
  return useContext(OrderTransportContext);
}

export function useCartStoreApi(): CartStore {
  return useContext(CartStoreContext);
}
