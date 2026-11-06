"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "../../shared/components/primitives/button";
import { TabSelector } from "./TabSelector";
import { ProductCarousel } from "./ProductCarousel";
import { useCarouselScroll } from "../../shared/hooks/useCarouselScroll";
import type { FeaturedEditProps } from "../../types";

export function FeaturedEdit({ title, buttonText, buttonLink, tabs }: FeaturedEditProps) {
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const { scrollRef, scroll, scrollToStart } = useCarouselScroll();

  const currentProducts = tabs[activeTabIndex]?.products ?? [];

  const handleSelectTab = (index: number) => {
    setActiveTabIndex(index);
    scrollToStart();
  };

  return (
    <section data-source="dynamic" data-source-note="Tabs and products come from the store's categories and products." data-section="featured-edit" className="bg-[var(--featured-bg)] pt-16 pb-24 md:pt-24 md:pb-32 overflow-hidden">
      <div className="max-w-container-max mx-auto w-full px-6 md:px-16 relative">
        <div className="flex flex-col mb-8 md:mb-12 gap-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-heading text-[32px] md:text-[42px] uppercase text-[var(--featured-text)] leading-none"
            >
              {title}
            </motion.h2>
            <Button asChild variant="default" size="lg" className="rounded-md w-fit">
              <Link href={buttonLink}>{buttonText}</Link>
            </Button>
          </div>

          <TabSelector tabs={tabs} activeIndex={activeTabIndex} onSelect={handleSelectTab} />
        </div>

        <ProductCarousel
          products={currentProducts}
          activeTabIndex={activeTabIndex}
          scrollRef={scrollRef}
          onScroll={scroll}
        />
      </div>
    </section>
  );
}
