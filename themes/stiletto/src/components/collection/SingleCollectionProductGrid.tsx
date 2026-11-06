import type { NormalizedCategory, NormalizedProduct } from "../../types";
import { ProductCard } from "../../shared/components/product/ProductCard";
import { CategoryCard } from "../category/CategoryCard";
import { ProductCarousel } from "../showcase/ProductCarousel";

interface SingleCollectionProductGridProps {
  products: NormalizedProduct[];
  otherCategories?: NormalizedCategory[];
  currentCategoryTitle?: string;
}

export function SingleCollectionProductGrid({
  products,
  otherCategories = [],
  currentCategoryTitle,
}: SingleCollectionProductGridProps) {
  return (
    <div data-source="dynamic" data-source-note="Products of this category come from the store." data-section="collection-grid" className="w-full">
      {/* 1. Main Products Section */}
      <section className="py-10 md:py-14 px-4 md:px-12 max-w-container-max mx-auto w-full overflow-hidden">

        {/* Clean Header without border line */}
        <div className="flex items-baseline justify-between mb-8">
          <h2 className="font-heading text-[22px] md:text-[32px] uppercase tracking-[0.12em] text-[var(--featured-text)] font-medium">
            Curated Pieces
          </h2>
          <span className="font-sans text-[11px] md:text-[12px] uppercase tracking-[0.18em] text-[var(--featured-card-muted)] font-medium">
            {products.length} {products.length === 1 ? "Product" : "Products"}
          </span>
        </div>

        {/* Product Cards Rendering */}
        {!products || products.length === 0 ? (
          <div className="py-12 text-center font-sans text-[15px] text-[var(--featured-card-muted)]">
            No products available in this collection yet.
          </div>
        ) : (
          <>
            {/* Desktop View: Smooth Carousel */}
            <div className="hidden md:block w-full">
              <ProductCarousel products={products} />
            </div>

            {/* Mobile View: 2-Column Grid */}
            <div className="block md:hidden w-full">
              <div className="grid grid-cols-2 gap-3">
                {products.map((product, idx) => (
                  <div key={product.id} className="w-full">
                    <ProductCard
                      product={product}
                      index={idx}
                      variant="featured"
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* 2. Other Categories Navigation Section */}
      {otherCategories && otherCategories.length > 0 && (
        <section className="py-12 md:py-16 px-4 md:px-12 max-w-container-max mx-auto w-full border-t border-[var(--separator-border)]">
          <div className="text-center mb-10">
            <span className="font-sans text-[11px] uppercase tracking-[0.2em] text-[var(--featured-card-muted)] font-semibold block mb-2">
              Discover More
            </span>
            <h2 className="font-heading text-[24px] md:text-[36px] uppercase tracking-[0.08em] text-[var(--featured-text)]">
              Explore Other Collections
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            {otherCategories.map((category) => (
              <div key={category.id} className="w-full">
                <CategoryCard {...category} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}