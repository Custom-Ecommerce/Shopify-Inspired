"use client";

import { useMemo } from "react";
import type { ProductPageProps } from "@markaz/storefront-data";
import { useProductViewEvent } from "@markaz/storefront-data/client";
import { ProductDetailView } from "../components/product-detail/ProductDetailView";
import { toStilettoProduct } from "../adapters/product";
import { useStilettoChrome } from "../adapters/chrome-context";
import { useStoreData } from "../shared/context/StoreDataContext";
import { StilettoFooter, StilettoHeader } from "./shell";
import { UnavailablePage } from "./unavailable-page";

export function ProductPage({ slug, product, reviews }: ProductPageProps) {
  const { content, categories } = useStilettoChrome();
  const { products } = useStoreData();
  const mapped = useMemo(() => (product ? toStilettoProduct(product) : null), [product]);
  // S8-B6: one anonymous product view per product shown (silent on the demo and in preview).
  useProductViewEvent(product ? slug : null);
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
          initialReviews={reviews}
          productHandle={slug}
          shippingDetails={content.shippingDetails}
        />
      </main>

      <StilettoFooter />
    </div>
  );
}
