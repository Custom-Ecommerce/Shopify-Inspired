"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ActiveLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function ActiveLink({ href, children, className, onClick }: ActiveLinkProps) {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Only track hash links
    if (!href.startsWith("/#")) return;
    
    const targetId = href.substring(2);
    const element = document.getElementById(targetId);
    if (!element) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsActive(true);
          } else {
            setIsActive(false);
          }
        });
      },
      { rootMargin: "-20% 0px -80% 0px", threshold: 0 }
    );
    
    observer.observe(element);
    return () => observer.disconnect();
  }, [href]);

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={isActive ? "location" : undefined}
      className={cn(
        className,
        isActive ? "text-foreground font-semibold" : ""
      )}
    >
      {children}
    </Link>
  );
}
