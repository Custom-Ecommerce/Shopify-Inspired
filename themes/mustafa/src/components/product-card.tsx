"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { buttonVariants } from "./ui/button";
import { storePaths, useCart } from "@markaz/storefront-data";
import type { ProductCardVM } from "@markaz/storefront-data";

export function ProductCard({ product }: { product: ProductCardVM }) {
  const { add, isHydrated } = useCart();
  const [justAdded, setJustAdded] = React.useState(false);

  const productUrl = storePaths.product(product.slug);
  const isOutOfStock = product.stock.status === "out_of_stock";
  const hasDiscount = product.compareAt !== null;
  const discountPct = product.discountPercent;
  const primaryImage = product.image?.url ?? null;
  const displayPrice = product.price.formatted;
  const displayCompareAt = product.compareAt?.formatted ?? null;

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOutOfStock) return;
    add(product, 1);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1600);
  };

  return (
    <Card
      variant="default"
      padding="none"
      interactive
      className="group relative flex flex-col justify-between h-full bg-[var(--mu-color-surface)] border border-[var(--mu-color-line)] rounded-[var(--mu-radius-card)]"
    >
      {/* Top Media Area (design.md §2.3: aspect-square, object-contain, p-4, white bg, badge top-right) */}
      <div className="relative aspect-square w-full bg-[var(--mu-color-surface)] p-4 overflow-hidden border-b border-[var(--mu-color-line)]">
        {isOutOfStock ? (
          <div className="absolute top-3 right-3 z-10">
            <Badge tone="neutral">SOLD OUT</Badge>
          </div>
        ) : hasDiscount ? (
          <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1">
            <Badge tone="sale">ON SALE</Badge>
            {discountPct > 0 && <Badge tone="sale">-{discountPct}%</Badge>}
          </div>
        ) : null}

        <Link
          href={productUrl}
          tabIndex={-1}
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center"
        >
          {primaryImage ? (
            <img
              src={primaryImage}
              alt={product.title}
              className="h-full w-full object-contain object-center transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-[var(--mu-radius-sm)] bg-[var(--mu-color-surface-muted)] text-[var(--mu-color-ink-muted)] text-xs">
              Local Produce
            </div>
          )}
        </Link>
      </div>

      {/* Card Content Body (design.md §2.3: price row -> title -> stars -> outline pill Buy now) */}
      <div className="flex flex-1 flex-col justify-between p-4 gap-3">
        <div className="flex flex-col gap-1.5">
          {/* Price Row First */}
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[length:var(--mu-text-body)] font-medium text-[var(--mu-color-ink)]">
              {displayPrice}
            </span>
            {hasDiscount && displayCompareAt && (
              <>
                <span className="sr-only">Regular price</span>
                <s className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-muted)]">
                  {displayCompareAt}
                </s>
              </>
            )}
          </div>

          {/* Title (text-h3, 2-line clamp) */}
          <h3 className="text-[length:var(--mu-text-h3)] font-normal leading-snug text-[var(--mu-color-ink)] line-clamp-2">
            <Link
              href={productUrl}
              className="hover:text-[var(--mu-color-brand-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mu-color-focus)] rounded-xs"
            >
              {product.title}
            </Link>
          </h3>

          {/* Star Rating Row */}
          <div
            role="img"
            aria-label="5.0 out of 5 stars"
            className="flex items-center gap-1.5 text-xs text-[var(--mu-color-ink)] pt-0.5"
          >
            <span className="tracking-tight" aria-hidden="true">
              ★★★★★
            </span>
            <span className="text-[var(--mu-color-ink-muted)]">
              ({product.rating?.count ?? 12})
            </span>
          </div>
        </div>

        {/* Full-Width Outline Pill Button */}
        <div className="pt-2 relative z-10">
          <button
            type="button"
            disabled={isOutOfStock || !isHydrated}
            onClick={handleQuickAdd}
            className={buttonVariants({
              variant: "outline",
              size: "md",
              fullWidth: true,
            })}
          >
            {isOutOfStock
              ? "Sold out"
              : justAdded
                ? "Added ✓"
                : "Buy now"}
          </button>
        </div>
      </div>
    </Card>
  );
}

export default ProductCard;
