"use client";

import { useMemo } from "react";
import type { CatalogPageProps } from "@markaz/storefront-data";
import { CategoryProductSection } from "../components/all-products/CategoryProductSection";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { toStilettoProduct } from "../adapters/product";
import { useStilettoChrome } from "../adapters/chrome-context";
import { StilettoFooter, StilettoHeader } from "./shell";
import { UnavailablePage } from "./unavailable-page";

export function CatalogPage({ data }: CatalogPageProps) {
  const { categories } = useStilettoChrome();
  const products = useMemo(() => (data.status === "ok" ? data.products.map((p) => toStilettoProduct(p)) : []), [data]);
  if (data.status === "unavailable") return <UnavailablePage />;
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative pt-20 md:pt-0">
        <CollectionHeader
          title="All Products"
          description="Explore our complete line of luxury undergarments and nightwear."
          itemCount={products.length}
        />

        <div className="py-12 md:py-16 px-4 md:px-12 max-w-container-max mx-auto w-full">
          {categories.map((category) => (
            <CategoryProductSection key={category.id} category={category} products={products} />
          ))}
        </div>
      </main>

      <StilettoFooter />
    </div>
  );
}
