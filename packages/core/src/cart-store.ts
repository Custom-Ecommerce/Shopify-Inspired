import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
import type { CartItem, Product } from "./types";
import { FREE_DELIVERY_THRESHOLD } from "./currency";

/** Fallback delivery fee used when a store has no rate configured. */
export const DEFAULT_DELIVERY_RATE = 200;

export interface CartState {
  items: CartItem[];
  tenantId: string;
  freeDeliveryThreshold: number;
  deliveryRate: number;
  isDrawerOpen: boolean;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export interface CartOptions {
  tenantId: string;
  freeDeliveryThreshold: number;
  deliveryRate: number;
}

/**
 * Creates one isolated cart store per tenant. Only `items` is persisted; the
 * drawer flag is UI state and always starts closed.
 */
export const createCartStore = ({ tenantId, freeDeliveryThreshold, deliveryRate }: CartOptions) =>
  createStore<CartState>()(
    persist(
      (set) => ({
        items: [],
        tenantId,
        freeDeliveryThreshold,
        deliveryRate,
        isDrawerOpen: false,
        addItem: (product, quantity = 1) =>
          set((state) => {
            const existing = state.items.find((i) => i.productId === product.id);
            if (existing) {
              return {
                items: state.items.map((i) =>
                  i.productId === product.id ? { ...i, quantity: i.quantity + quantity } : i,
                ),
              };
            }
            const line: CartItem = {
              productId: product.id,
              slug: product.slug,
              title: product.title,
              image: product.images[0] ?? "",
              price: product.price,
              originalPrice: product.originalPrice,
              categorySlug: product.categorySlug,
              deliveryCharges: product.deliveryCharges,
              stockStatus: product.stockStatus,
              quantity,
            };
            return { items: [...state.items, line] };
          }),
        removeItem: (productId) =>
          set((state) => ({ items: state.items.filter((i) => i.productId !== productId) })),
        updateQuantity: (productId, quantity) =>
          set((state) => ({
            items:
              quantity <= 0
                ? state.items.filter((i) => i.productId !== productId)
                : state.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)),
          })),
        clearCart: () => set({ items: [] }),
        openDrawer: () => set({ isDrawerOpen: true }),
        closeDrawer: () => set({ isDrawerOpen: false }),
      }),
      {
        name: `markaz-cart:${tenantId}`,
        partialize: (state) => ({ items: state.items }),
      },
    ),
  );

export type CartStoreApi = ReturnType<typeof createCartStore>;

/**
 * The one React context every cart consumer reads. The app mounts a provider
 * with a store created by `createCartStore`; components never own a store.
 */
export const CartStoreContext = createContext<CartStoreApi | null>(null);

/** Reads the nearest cart store. Throws when no provider is mounted. */
export function useCartStore<T>(selector: (state: CartState) => T): T {
  const store = useContext(CartStoreContext);
  if (!store) {
    throw new Error("useCartStore must be used inside a CartStoreContext provider");
  }
  return useStore(store, selector);
}

/** Total number of units in the cart. */
export function selectTotalItemsCount(items: readonly CartItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

/** Sum of line prices before delivery. */
export function selectSubtotal(items: readonly CartItem[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

/**
 * Delivery fee for a cart. Free at or above the threshold; otherwise the
 * store's rate. Defaults are used when the caller passes no store settings.
 */
export function computeDeliveryFee(
  items: readonly CartItem[],
  options: { freeDeliveryThreshold?: number; deliveryRate?: number } = {},
): number {
  if (items.length === 0) return 0;
  const threshold = options.freeDeliveryThreshold ?? FREE_DELIVERY_THRESHOLD;
  const rate = options.deliveryRate ?? DEFAULT_DELIVERY_RATE;
  return selectSubtotal(items) >= threshold ? 0 : rate;
}
