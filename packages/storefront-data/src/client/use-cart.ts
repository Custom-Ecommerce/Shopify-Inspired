"use client";

import { useCallback, useEffect, useMemo } from "react";
import { toCartVM } from "../view-models/cart";
import type { CartVM } from "../view-models/cart";
import type { ProductCardVM } from "../view-models/product-card";
import { useCartStoreApi } from "./context";

export type CartableProductVM = Pick<ProductCardVM, "id" | "slug" | "title" | "image" | "price">;

export interface UseCartResult extends CartVM {
  isHydrated: boolean;
  add: (product: CartableProductVM, qty?: number) => void;
  /** Sets one line's quantity. Below 1 removes the line. Quantities are capped at MAX_LINE_QTY. */
  setQty: (lineId: string, qty: number) => void;
  remove: (lineId: string) => void;
  /** Empties the cart. Used after a successful order. */
  clear: () => void;
}

/** The cart of the storefront this component is rendered under. The demo has one; a live store has its own. */
export function useCart(): UseCartResult {
  const store = useCartStoreApi();
  const lines = store((state) => state.lines);
  const isHydrated = store((state) => state.isHydrated);
  const addLine = store((state) => state.addLine);
  const setLineQty = store((state) => state.setLineQty);
  const removeLine = store((state) => state.removeLine);
  const clearLines = store((state) => state.clearLines);

  useEffect(() => {
    const finish = () => store.getState().markHydrated();
    if (store.persist.hasHydrated()) {
      finish();
      return;
    }
    // rehydrate() completes synchronously for localStorage. finally() also covers a failed read,
    // so the cart never stays stuck in the loading state.
    Promise.resolve(store.persist.rehydrate()).finally(finish);
  }, [store]);

  const view = useMemo(() => toCartVM(lines), [lines]);

  const add = useCallback(
    (product: CartableProductVM, qty = 1) => {
      addLine(
        {
          id: product.id,
          slug: product.slug,
          title: product.title,
          image: product.image,
          unitPrice: product.price.amount,
        },
        qty,
      );
    },
    [addLine],
  );

  return { ...view, isHydrated, add, setQty: setLineQty, remove: removeLine, clear: clearLines };
}
