import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { addCartLine, removeCartLine, setCartLineQty } from "../domain/cart";
import type { CartableProduct, CartLine } from "../domain/cart";

const CART_STORAGE_VERSION = 1;

/** The demo storefront's cart. Stores with a tenant key get their own: see createStorefrontCartStore. */
export const DEMO_CART_KEY = "markaz-cart:demo";

export interface CartStoreState {
  lines: CartLine[];
  // False until the persisted cart has been read. This keeps the server render and the first client render identical,
  // so cart-dependent UI waits for it.
  isHydrated: boolean;
  addLine: (item: CartableProduct, qty: number) => void;
  /** Sets a line's quantity. A quantity below 1 removes the line. */
  setLineQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  clearLines: () => void;
  markHydrated: () => void;
}

type PersistedCart = Pick<CartStoreState, "lines">;

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.id === "string" &&
    typeof line.productId === "string" &&
    typeof line.slug === "string" &&
    typeof line.title === "string" &&
    typeof line.unitPrice === "number" &&
    typeof line.qty === "number"
  );
}

// Drops anything that does not look like a cart line, so a corrupt localStorage entry cannot crash render.
function readLines(persisted: unknown): CartLine[] {
  const lines = (persisted as Partial<PersistedCart> | null | undefined)?.lines;
  return Array.isArray(lines) ? lines.filter(isCartLine) : [];
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
        addLine: (item, qty) => set((state) => ({ lines: addCartLine(state.lines, item, qty) })),
        setLineQty: (lineId, qty) => set((state) => ({ lines: setCartLineQty(state.lines, lineId, qty) })),
        removeLine: (lineId) => set((state) => ({ lines: removeCartLine(state.lines, lineId) })),
        clearLines: () => set({ lines: [] }),
        markHydrated: () => set({ isHydrated: true }),
      }),
      {
        name: storageKey,
        version: CART_STORAGE_VERSION,
        storage: createJSONStorage(() => localStorage),
        partialize: (state): PersistedCart => ({ lines: state.lines }),
        merge: (persisted, current) => ({ ...current, lines: readLines(persisted) }),
        // Version 1 is the first shape, so there is nothing to migrate. Unknown versions start empty.
        migrate: () => ({ lines: [] }),
        skipHydration: true,
      },
    ),
  );
}

export type CartStore = ReturnType<typeof createStorefrontCartStore>;

/** Used when no store is mounted, which is the demo route. */
export const DEMO_CART_STORE: CartStore = createStorefrontCartStore(DEMO_CART_KEY);
