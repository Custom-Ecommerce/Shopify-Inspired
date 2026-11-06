"use client";

import { useCallback, useRef, type RefObject } from "react";

interface UseCarouselScrollOptions {
  /** Gap between cards in px on mobile viewports (< 768px). Default 16. */
  mobileGap?: number;
  /** Gap between cards in px on desktop viewports (>= 768px). Default 24. */
  desktopGap?: number;
  /** Tailwind `md` breakpoint in px. Default 768. */
  breakpoint?: number;
}

interface UseCarouselScrollReturn {
  scrollRef: RefObject<HTMLDivElement | null>;
  scroll: (direction: "left" | "right") => void;
  scrollToStart: () => void;
}

/**
 * Encapsulates the "scroll by exactly one card + gap" behavior shared by
 * CategoryCarousel, ProductShowcase, and FeaturedEdit.
 */
export function useCarouselScroll(
  options: UseCarouselScrollOptions = {}
): UseCarouselScrollReturn {
  const { mobileGap = 16, desktopGap = 24, breakpoint = 768 } = options;
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = useCallback(
    (direction: "left" | "right") => {
      const container = scrollRef.current;
      if (!container || container.children.length === 0) return;

      const cardElement = container.children[0] as HTMLElement;
      const gap = window.innerWidth >= breakpoint ? desktopGap : mobileGap;
      const scrollAmount = cardElement.offsetWidth + gap;

      container.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    },
    [breakpoint, desktopGap, mobileGap]
  );

  const scrollToStart = useCallback(() => {
    scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, []);

  return { scrollRef, scroll, scrollToStart };
}
