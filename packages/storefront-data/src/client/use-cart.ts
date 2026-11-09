"use client";

import { useCallback, useEffect, useMemo } from "react";
import { toCartVM } from "../view-models/cart";
import type { CartVM } from "../view-models/cart";
import type { Money } from "../domain/money";
import type { ProductCardVM } from "../view-models/product-card";
import { useCartStoreApi } from "./context";

export type CartableProductVM = Pick<
  ProductCardVM,
  "id" | "slug" | "title" | "image" | "price" | "defaultVariantId" | "hasVariants"
>;

/** The variant a shopper chose. Not needed for a product with one variant. */
export interface CartableVariantVM {
  id: string;
  title: string;
  price: Money;
}

export interface UseCartResult extends CartVM {
  isHydrated: boolean;
  /**
   * Adds a product. A product with one variant needs nothing more. A product with several needs the variant the shopper
   * chose: without one nothing is added and this answers false, because a shopper must never get a size they did not pick.
   */
  add: (product: CartableProductVM, qty?: number, variant?: CartableVariantVM) => boolean;
  /** Sets one line's quantity. Below 1 removes the line. Quantities are capped at MAX_LINE_QTY. */
  setQty: (lineId: string, qty: number) => void;
  remove: (lineId: string) => void;
  /** Empties the cart, and forgets its code. Used after a successful order. */
  clear: () => void;
  /** The shopper's code, in capitals, whether or not the server has accepted it yet. */
  discountCode: string | null;
  /** Sets or, with null or blank, removes the code. */
  setDiscountCode: (code: string | null) => void;
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
  const discountCode = store((state) => state.discountCode);
  const storeDiscountCode = store((state) => state.setDiscountCode);

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
    (product: CartableProductVM, qty = 1, variant?: CartableVariantVM) => {
      if (!variant && product.hasVariants) return false;
      addLine(
        {
          id: product.id,
          variantId: variant?.id ?? product.defaultVariantId,
          variantTitle: variant?.title ?? null,
          slug: product.slug,
          title: product.title,
          image: product.image,
          unitPrice: (variant?.price ?? product.price).amount,
        },
        qty,
      );
      return true;
    },
    [addLine],
  );

  const setDiscountCode = useCallback(
    (code: string | null) => storeDiscountCode(code?.trim().toUpperCase() || null),
    [storeDiscountCode],
  );

  return { ...view, isHydrated, add, setQty: setLineQty, remove: removeLine, clear: clearLines, discountCode, setDiscountCode };
}
