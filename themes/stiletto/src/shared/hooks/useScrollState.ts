"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether the window has been scrolled past `threshold` pixels.
 * Used to toggle the Header between transparent and solid states.
 */
export function useScrollState(threshold = 50): boolean {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > threshold);
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  return isScrolled;
}
