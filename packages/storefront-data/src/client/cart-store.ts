import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import { MAX_CART_LINES, addCartLine, applyLinePrices, removeCartLine, setCartLineQty } from "../domain/cart";
import type { CartableProduct, CartLine } from "../domain/cart";

/** Version 2: a line names its variant. */
const CART_STORAGE_VERSION = 2;

/** The demo storefront's cart. Stores with a tenant key get their own: see createStorefrontCartStore. */
export const DEMO_CART_KEY = "markaz-cart:demo";

/**
 * Where a cart is kept. One key per store, so stores never share a cart. A seller's preview has its own, because it can hold
 * drafts and sample products that must never reach the live cart. Each demo theme has its own too.
 */
export function cartStorageKey(scope: { storeKey?: string; preview?: boolean; demoScope?: string }): string {
  if (scope.storeKey) return (scope.preview ? "markaz-cart:preview:" : "markaz-cart:") + scope.storeKey;
  return scope.demoScope ? DEMO_CART_KEY + ":" + scope.demoScope : DEMO_CART_KEY;
}

/** Private browsing and a full disk both make localStorage throw. The cart then simply lasts as long as the page. */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* not kept */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* nothing to remove */
    }
  },
};

export interface CartStoreState {
  lines: CartLine[];
  // False until the persisted cart has been read. This keeps the server render and the first client render identical,
  // so cart-dependent UI waits for it.
  isHydrated: boolean;
  /** The shopper's code, kept with the cart until the order is placed or they remove it. */
  discountCode: string | null;
  setDiscountCode: (code: string | null) => void;
  addLine: (item: CartableProduct, qty: number) => void;
  /** Sets a line's quantity. A quantity below 1 removes the line. */
  setLineQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  /** Replaces remembered prices with the server's current ones. */
  applyPrices: (prices: ReadonlyArray<{ lineId: string; unitPrice: number }>) => void;
  clearLines: () => void;
  markHydrated: () => void;
}

type PersistedCart = Pick<CartStoreState, "lines" | "discountCode">;

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.id === "string" &&
    typeof line.productId === "string" &&
    typeof line.variantId === "string" &&
    typeof line.slug === "string" &&
    typeof line.title === "string" &&
    typeof line.unitPrice === "number" &&
    typeof line.qty === "number"
  );
}

function readDiscountCode(persisted: unknown): string | null {
  const code = (persisted as Partial<PersistedCart> | null | undefined)?.discountCode;
  return typeof code === "string" && code !== "" ? code : null;
}

// Drops anything that does not look like a cart line, so a corrupt localStorage entry cannot crash render.
function readLines(persisted: unknown): CartLine[] {
  const lines = (persisted as Partial<PersistedCart> | null | undefined)?.lines;
  return Array.isArray(lines) ? lines.filter(isCartLine).slice(0, MAX_CART_LINES) : [];
}

/**
 * A cart for one storefront. Each store gets its own storage key, so a shopper's cart on one store is never shown on
 * another. Nothing is read until the cart hydrates on the client.
 */
export function createStorefrontCartStore(storageKey: string) {
  return create<CartStoreState>()(
    persist(
      (set) => ({
        lines: [],
        isHydrated: false,
        discountCode: null,
        setDiscountCode: (code) => set({ discountCode: code }),
        addLine: (item, qty) => set((state) => ({ lines: addCartLine(state.lines, item, qty) })),
        setLineQty: (lineId, qty) => set((state) => ({ lines: setCartLineQty(state.lines, lineId, qty) })),
        removeLine: (lineId) => set((state) => ({ lines: removeCartLine(state.lines, lineId) })),
        applyPrices: (prices) => set((state) => ({ lines: applyLinePrices(state.lines, prices) })),
        clearLines: () => set({ lines: [], discountCode: null }),
        markHydrated: () => set({ isHydrated: true }),
      }),
      {
        name: storageKey,
        version: CART_STORAGE_VERSION,
        storage: createJSONStorage(() => safeLocalStorage),
        partialize: (state): PersistedCart => ({ lines: state.lines, discountCode: state.discountCode }),
        merge: (persisted, current) => ({ ...current, lines: readLines(persisted), discountCode: readDiscountCode(persisted) }),
        // A version 1 line names no variant, and only the server knows which it would be, so older carts start empty.
        migrate: () => ({ lines: [] }),
        skipHydration: true,
      },
    ),
  );
}

export type CartStore = ReturnType<typeof createStorefrontCartStore>;

/** Used when no store is mounted, which is the demo route. */
export const DEMO_CART_STORE: CartStore = createStorefrontCartStore(DEMO_CART_KEY);
