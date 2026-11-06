"use client";

import { useState } from "react";
import type { ProductDetailVM } from "@markaz/storefront-data";
import type { NormalizedCategory, NormalizedProduct, ReviewItem } from "../../types";
import { CategoryCarousel } from "../category/CategoryCarousel";
import { ProductCarousel } from "../showcase/ProductCarousel";
import { ProductAccordion } from "./ProductAccordion";
import { ProductGallery } from "./ProductGallery";
import { ProductInfo } from "./ProductInfo";
import { ProductReviewsSection } from "./ProductReviewsSection";
import { ProductVideos } from "./ProductVideos";

interface ProductDetailViewProps {
  product: NormalizedProduct;
  /** The data layer's product: the selector reads its options and variants. */
  detail: ProductDetailVM;
  allProducts: NormalizedProduct[];
  categories: NormalizedCategory[];
  reviews?: ReviewItem[];
  productHandle?: string;
  shippingDetails?: string[];
}

export function ProductDetailView({
  product,
  detail,
  allProducts,
  categories,
  reviews = [],
  productHandle = "",
  shippingDetails = [],
}: ProductDetailViewProps) {
  const [variantImageId, setVariantImageId] = useState<string | null>(null);

  const similarProducts = allProducts.filter(
    (p) =>
      p.id !== product.id &&
      p.productType.toLowerCase() === product.productType.toLowerCase()
  );

  const otherCategories = categories.filter(
    (cat) => cat.title.toLowerCase() !== product.productType.toLowerCase()
  );

  return (
    <div className="w-full">
      <div className="py-8 md:py-16 px-4 md:px-12 max-w-container-max mx-auto w-full space-y-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-start">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              {detail.videos.length > 0 && (
                <h2 className="font-sans text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--featured-text)]">Images</h2>
              )}
              <ProductGallery images={product.gallery ?? product.images.map((url) => ({ url, alt: product.title }))} title={product.title} activeImageId={variantImageId} />
            </div>
            <ProductVideos videos={detail.videos} title={product.title} />
          </div>

          <div className="flex flex-col">
            <ProductInfo product={product} detail={detail} onVariantImage={setVariantImageId} />
            <ProductAccordion
              descriptionHtml={product.descriptionHtml}
              plainTextDescription={product.plainTextDescription}
              specs={product.specs}
              shippingDetails={shippingDetails}
            />
          </div>
        </div>

        <ProductReviewsSection
          reviews={reviews}
          productHandle={productHandle || product.handle || ""}
        />

        <section className="pt-12 border-t border-[var(--separator-border)]">
          <h2 className="font-heading text-[22px] md:text-[30px] uppercase tracking-[0.08em] text-[var(--featured-text)] mb-6">
            Similar Products
          </h2>

          {similarProducts.length > 0 ? (
            <ProductCarousel products={similarProducts} />
          ) : (
            <div className="py-8 text-center border border-dashed border-[var(--separator-border)] rounded-md bg-[var(--featured-bg-secondary)]">
              <p className="font-sans text-[14px] uppercase tracking-[0.1em] text-[var(--featured-card-muted)] font-medium">
                No similar products available
              </p>
            </div>
          )}
        </section>
      </div>

      {otherCategories.length > 0 && (
        <div className="w-full border-t border-[var(--separator-border)]">
          <CategoryCarousel
            title="Explore Other Categories"
            items={otherCategories}
          />
        </div>
      )}
    </div>
  );
}