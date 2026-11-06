"use client";

import { useEffect } from "react";
import type { CartPageProps } from "@markaz/storefront-data";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { useCartContext } from "../shared/context/CartContext";
import { StilettoFooter, StilettoHeader } from "./shell";

/** The original design has a cart drawer and no cart page, so this page shows the shell and opens the drawer. */
export function CartPage(_props: CartPageProps) {
  const { setIsCartOpen, cartCount } = useCartContext();
  useEffect(() => {
    setIsCartOpen(true);
  }, [setIsCartOpen]);
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <CollectionHeader title="Your Cart" description="Review your items in the cart drawer." itemCount={cartCount} />
      </main>

      <StilettoFooter />
    </div>
  );
}
