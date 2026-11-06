"use client";

import type { SearchPageProps } from "@markaz/storefront-data";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { SingleCollectionProductGrid } from "../components/collection/SingleCollectionProductGrid";
import { toStilettoProduct } from "../adapters/product";
import { StilettoFooter, StilettoHeader } from "./shell";

export function SearchPage({ query, results }: SearchPageProps) {
  const mapped = results.map((p) => toStilettoProduct(p));
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <CollectionHeader
          title={query ? `Search: ${query}` : "Search"}
          description="Search runs over the products currently loaded for this store."
          itemCount={mapped.length}
        />

        <SingleCollectionProductGrid products={mapped} />
      </main>

      <StilettoFooter />
    </div>
  );
}
