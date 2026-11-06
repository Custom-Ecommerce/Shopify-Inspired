"use client";

import React from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { CategoryCard } from "./CategoryCard";
import { useCarouselScroll } from "../../shared/hooks/useCarouselScroll";
import { fadeInUp, fadeInSlideX, staggerDelay } from "../../shared/lib/animations";
import type { CategoryCarouselProps } from "../../types";

export function CategoryCarousel({ title, items }: CategoryCarouselProps) {
  const { scrollRef, scroll } = useCarouselScroll();

  return (
    <section data-source="dynamic" data-source-note="Categories come from the store's products." data-section="category-carousel" className="py-12 bg-[var(--category-carousel-bg)]">
      <div className="px-6 md:px-16 max-w-container-max mx-auto w-full relative">
        <div className="mb-8 md:mb-12">
          <motion.h2
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="w-full uppercase text-[var(--text-primary)] font-normal tracking-tight leading-tight text-[30px] md:text-[40px]"
          >
            {title}
          </motion.h2>
        </div>

        <div className="relative w-full">
          <button
            onClick={() => scroll("left")}
            className="hidden md:flex absolute left-0 md:left-2 top-[40%] -translate-y-1/2 z-20 w-[44px] h-[44px] rounded-full bg-[var(--category-arrow-bg)]/90 hover:bg-[var(--category-arrow-bg-hover)] text-[var(--text-inverse)] items-center justify-center transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={1} />
          </button>

          <div ref={scrollRef} className="flex gap-4 md:gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-4">
            {items.map((item, idx) => (
              <motion.div
                key={item.id}
                variants={fadeInSlideX}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                transition={staggerDelay(idx)}
                className="snap-start shrink-0 w-[40vw] md:w-[28vw] lg:w-[21%] max-w-[300px]"
              >
                <CategoryCard {...item} />
              </motion.div>
            ))}
          </div>

          <button
            onClick={() => scroll("right")}
            className="hidden md:flex absolute right-0 md:right-2 top-[40%] -translate-y-1/2 z-20 w-[44px] h-[44px] rounded-full bg-[var(--category-arrow-bg)]/90 hover:bg-[var(--category-arrow-bg-hover)] text-[var(--text-inverse)] items-center justify-center transition-colors cursor-pointer"
          >
            <ArrowRight className="w-5 h-5" strokeWidth={1} />
          </button>
        </div>
      </div>
    </section>
  );
}
