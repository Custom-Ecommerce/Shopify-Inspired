"use client";

import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCarouselScroll } from "../../shared/hooks/useCarouselScroll";
import { ProductCard } from "../../shared/components/product/ProductCard";
import type { NormalizedProduct } from "../../types";

export interface ProductCarouselProps {
  products: NormalizedProduct[];
}

export function ProductCarousel({ products }: ProductCarouselProps) {
  const { scrollRef, scroll } = useCarouselScroll();

  return (
    <div className="relative w-full">
      <div ref={scrollRef} className="flex gap-4 md:gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-4">
        {products.map((product, idx) => (
          <ProductCard key={product.id} product={product} index={idx} variant="showcase" />
        ))}
      </div>
    </div>
  );
}
