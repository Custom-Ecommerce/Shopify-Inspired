"use client";

import { useState } from "react";
import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import type { ProductDetailVM } from "@markaz/storefront-data";
import { useCart } from "@markaz/storefront-data/client";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

export function AddToCart({ product }: { product: ProductDetailVM }) {
  const { add, isHydrated } = useCart();
  const [added, setAdded] = useState(false);
  const soldOut = !product.canAddToCart;

  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        fullWidth
        disabled={soldOut || !isHydrated}
        onClick={() => {
          add(product, 1);
          setAdded(true);
        }}
      >
        {soldOut ? "Out of stock" : "Add to cart"}
      </Button>
      {added ? (
        <Alert tone="success">
          <p>
            Added to your cart.{" "}
            <Link href={storePaths.cart} className="font-medium underline underline-offset-4">
              View cart
            </Link>
          </p>
        </Alert>
      ) : null}
    </div>
  );
}
