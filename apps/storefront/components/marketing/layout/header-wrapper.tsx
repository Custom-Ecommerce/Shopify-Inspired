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
        "sticky top-0 z-40 w-full border-b border-border transition-[background-color,backdrop-filter] duration-(--dur-base)",
        scrolled ? "bg-background/80 backdrop-blur-md" : "bg-background"
      )}
    >
      {children}
    </header>
  );
}
