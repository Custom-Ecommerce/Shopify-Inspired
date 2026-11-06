"use client";

import type { CollectionPageProps } from "@markaz/storefront-data";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { SingleCollectionProductGrid } from "../components/collection/SingleCollectionProductGrid";
import { toStilettoCategory, toStilettoProduct } from "../adapters/product";
import { useStilettoChrome } from "../adapters/chrome-context";
import { StilettoFooter, StilettoHeader } from "./shell";

export function CollectionPage({ category, products }: CollectionPageProps) {
  const { categories } = useStilettoChrome();
  const current = toStilettoCategory(category);
  const mapped = products.map((p) => toStilettoProduct(p));
  const otherCategories = categories.filter((cat) => cat.handle !== current.handle);
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <CollectionHeader
          title={current.title}
          description={current.plainTextDescription || `Explore our curated selection of ${current.title}.`}
          itemCount={mapped.length}
          category={current}
        />

        <SingleCollectionProductGrid products={mapped} otherCategories={otherCategories} currentCategoryTitle={current.title} />
      </main>

      <StilettoFooter />
    </div>
  );
}
