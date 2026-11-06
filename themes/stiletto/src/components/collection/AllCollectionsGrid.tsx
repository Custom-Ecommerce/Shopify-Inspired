import React from "react";
import { CategoryCard } from "../category/CategoryCard";
import type { AllCollectionsGridProps } from "../../types";

export function AllCollectionsGrid({ categories }: AllCollectionsGridProps) {
  if (!categories || categories.length === 0) {
    return (
      <div className="py-20 text-center font-sans text-[16px] text-[var(--featured-card-muted)]">
        No collections found.
      </div>
    );
  }

  return (
    <section data-source="dynamic" data-source-note="Collections come from the store's categories." data-section="all-collections" className="py-12 md:py-16 px-6 md:px-10 max-w-container-max mx-auto w-full">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {categories.map((category) => (
          <div key={category.id} className="w-full">
            <CategoryCard {...category} />
          </div>
        ))}
      </div>
    </section>
  );
}