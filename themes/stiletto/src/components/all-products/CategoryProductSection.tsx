"use client";

import React from "react";
import Link from "next/link";
import { paths } from "../../adapters/paths";
import { ProductCarousel } from "../showcase/ProductCarousel";
import { productMatchesCategory } from "../../shared/lib/productCategoryMatch";
import type { CategoryProductSectionProps } from "../../types";

export function CategoryProductSection({
  category,
  products,
}: CategoryProductSectionProps) {
  const categoryProducts = products.filter((product) =>
    productMatchesCategory(product, category)
  );

  return (
    <section data-source="dynamic" data-source-note="Category groups and products come from the store." data-section="all-products" className="py-8 md:py-12 border-b border-[var(--separator-border)] last:border-b-0">
      {/* 1. Header with Category Title, Items Count & Collection Page Link */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[var(--featured-card-muted)] font-semibold block mb-4">
            {categoryProducts.length} {categoryProducts.length === 1 ? "Item" : "Items"} Available
          </span>
          <h2 className="font-heading text-[26px] md:text-[38px] uppercase tracking-[0.08em] text-[var(--featured-text)] leading-none">
            {category.title}
          </h2>
        </div>

        {/* View Collection Link / Button */}
        <div>
          <Link
            href={category.href || paths.collection(category.handle)}
            className="inline-flex items-center gap-2 font-sans text-[12px] uppercase tracking-[0.15em] font-medium text-[var(--featured-text)] border-b border-[var(--featured-text)] pb-4 hover:opacity-60 transition-opacity"
          >
            View Collection &rarr;
          </Link>
        </div>
      </div>

      {/* 2. Carousel for Products */}
      {categoryProducts.length === 0 ? (
        <div className="py-8 text-center font-sans text-[13px] uppercase tracking-[0.1em] text-[var(--featured-card-muted)] italic">
          No products in this category
        </div>
      ) : (
        <div className="w-full overflow-hidden">
          <ProductCarousel products={categoryProducts} />
        </div>
      )}
    </section>
  );
}