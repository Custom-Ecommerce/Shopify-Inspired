"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function HeaderWrapper({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 8);
    };
    
    // Initial check
    handleScroll();
    
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header 
      className={cn(
        "sticky top-0 z-40 w-full transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300",
        scrolled 
          ? "border-b border-border bg-background/80 backdrop-blur-md shadow-xs" 
          : "border-b border-transparent bg-background/60"
      )}
    >
      {children}
    </header>
  );
}
