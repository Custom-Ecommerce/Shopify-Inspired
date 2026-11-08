"use client";

import { useMemo } from "react";
import type { ProductPageProps } from "@markaz/storefront-data";
import { ProductDetailView } from "../components/product-detail/ProductDetailView";
import { toStilettoProduct } from "../adapters/product";
import { useStilettoChrome } from "../adapters/chrome-context";
import { useStoreData } from "../shared/context/StoreDataContext";
import { StilettoFooter, StilettoHeader } from "./shell";
import { UnavailablePage } from "./unavailable-page";

export function ProductPage({ slug, product }: ProductPageProps) {
  const { content, categories } = useStilettoChrome();
  const { products } = useStoreData();
  const mapped = useMemo(() => (product ? toStilettoProduct(product, content.sampleReviews) : null), [product, content.sampleReviews]);
  if (!product || !mapped) return <UnavailablePage message="We could not load this product just now. Please try again in a moment." />;
  return (
    <div className="min-h-screen bg-[var(--featured-bg,#FAF9F6)]">
      <StilettoHeader />

      <main className="relative pt-20 md:pt-20">
        <ProductDetailView
          product={mapped}
          detail={product}
          allProducts={products}
          categories={categories}
          reviews={mapped.reviews}
          productHandle={slug}
          shippingDetails={content.shippingDetails}
        />
      </main>

      <StilettoFooter />
    </div>
  );
}
