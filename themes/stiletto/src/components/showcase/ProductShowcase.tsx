import React from "react";
import { BannerPanel } from "./BannerPanel";
import { ProductCarousel } from "./ProductCarousel";
import type { ProductShowcaseProps } from "../../types";

export function ProductShowcase({ banner, products }: ProductShowcaseProps) {
  return (
    <section data-source="partial" data-source-note="Products are the store's; the banner panel is theme content." data-section="product-showcase" className="bg-[var(--showcase-bg)] pt-16 pb-16 md:pt-24 md:pb-24 overflow-hidden">
      <div className="max-w-container-max mx-auto w-full px-6 md:px-16">
        <BannerPanel banner={banner} />
        <ProductCarousel products={products as any} /> 
      </div>
    </section>
  );
}
