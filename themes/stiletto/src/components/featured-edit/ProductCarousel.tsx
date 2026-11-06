"use client";

import React, { type RefObject } from "react";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ProductCard } from "../../shared/components/product/ProductCard";
import type { NormalizedProduct } from "../../types";

export interface ProductCarouselProps {
  products: NormalizedProduct[];
  activeTabIndex: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (direction: "left" | "right") => void;
}

export function ProductCarousel({ products, activeTabIndex, scrollRef, onScroll }: ProductCarouselProps) {
  return (
    <div className="relative w-full">
      {/* Buttons remain same */}
      <div ref={scrollRef} className="flex gap-4 md:gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-4">
        <AnimatePresence mode="popLayout">
          {products.map((product, idx) => (
            <ProductCard
              key={`${activeTabIndex}-${product.id}`}
              product={product}
              index={idx}
              variant="featured"
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
