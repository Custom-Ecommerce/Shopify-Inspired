"use client";

import type { CollectionsPageProps } from "@markaz/storefront-data";
import { AllCollectionsGrid } from "../components/collection/AllCollectionsGrid";
import { CollectionHeader } from "../components/collection/CollectionHeader";
import { toStilettoCategory } from "../adapters/product";
import { StilettoFooter, StilettoHeader } from "./shell";

export function CollectionsPage({ categories }: CollectionsPageProps) {
  const mapped = categories.map(toStilettoCategory);
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative">
        <CollectionHeader
          title="All Collections"
          description="Explore our complete line of luxury undergarments, crafted with precision, support, and elegance."
          itemCount={mapped.length}
        />

        <AllCollectionsGrid categories={mapped} />
      </main>

      <StilettoFooter />
    </div>
  );
}
