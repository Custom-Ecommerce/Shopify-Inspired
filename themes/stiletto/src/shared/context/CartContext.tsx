"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toMoney } from "@markaz/storefront-data";
import { useCart } from "@markaz/storefront-data/client";
import { PLACEHOLDER_IMAGE } from "../../adapters/images";

export interface CustomAttribute {
  key: string;
  value: string;
}

export interface CartItem {
  lineId: string;
  productId?: string;
  handle?: string;
  title: string;
  price: string;
  numericPrice: number;
  image: string;
  quantity: number;
  /** The chosen variant, for a product that has several. */
  variantTitle?: string;
  size?: string;
  color?: string;
  pack?: string;
  productType?: string;
  customAttributes?: CustomAttribute[];
}

/** "Rs. 1,299" or "1299.0" to 1299. */
export function parseNumericPrice(price: string): number {
  const value = Number(String(price).replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

interface CartContextValue {
  cartItems: CartItem[];
  cartCount: number;
  subtotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  addToCart: (item: Omit<CartItem, "numericPrice">) => { isAlreadyInCart: boolean };
  removeFromCart: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * The original cart context, on top of the storefront's cart. The public API is unchanged, so no component changes.
 * The cart itself (lines, persistence per store, quantity caps) belongs to the storefront; only the drawer's open state lives here.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const cart = useCart();
  const [isCartOpen, setIsCartOpen] = useState(false);

  const cartItems = useMemo<CartItem[]>(
    () =>
      cart.lines.map((line) => ({
        lineId: line.id,
        productId: line.productId,
        handle: line.slug,
        title: line.title,
        price: String(line.unitPrice.amount),
        numericPrice: line.unitPrice.amount,
        image: line.image?.url ?? PLACEHOLDER_IMAGE,
        quantity: line.qty,
        variantTitle: line.variantTitle ?? undefined,
      })),
    [cart.lines],
  );

  const { add, remove, setQty, clear, lines } = cart;

  const addToCart = useCallback<CartContextValue["addToCart"]>(
    (item) => {
      // As before, adding something already in the cart opens the cart and leaves the quantity alone.
      const isAlreadyInCart = lines.some((line) => line.id === item.lineId);
      if (!isAlreadyInCart) {
        add(
          {
            id: item.productId ?? item.lineId,
            slug: item.handle ?? item.lineId,
            title: item.title,
            image: item.image ? { url: item.image, alt: item.title } : null,
            price: toMoney(parseNumericPrice(item.price)),
            // The adapter gives each product its variant id as the line id.
            defaultVariantId: item.lineId,
            hasVariants: false,
          },
          item.quantity,
          item.variantTitle
            ? { id: item.lineId, title: item.variantTitle, price: toMoney(parseNumericPrice(item.price)) }
            : undefined,
        );
      }
      setIsCartOpen(true);
      return { isAlreadyInCart };
    },
    [add, lines],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      cartItems,
      cartCount: cart.itemCount,
      subtotal: cart.subtotal.amount,
      isCartOpen,
      setIsCartOpen,
      addToCart,
      removeFromCart: remove,
      updateQuantity: setQty,
      clearCart: clear,
    }),
    [cartItems, cart.itemCount, cart.subtotal.amount, isCartOpen, addToCart, remove, setQty, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCartContext(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCartContext must be used inside CartProvider");
  return ctx;
}
