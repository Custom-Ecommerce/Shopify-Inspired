import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import Link from "next/link";
import React from "react";

export function BrandMark({ className, href = "/", ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { href?: string }) {
  return (
    <Link 
      href={href} 
      className={cn("flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      aria-label={`${BRAND.name} Home`}
      {...props}
    >
      <div 
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-lg font-semibold text-primary-foreground shadow-sm"
        aria-hidden="true"
      >
        {BRAND.name.charAt(0)}
      </div>
      <span className="font-heading text-xl font-semibold tracking-tight text-foreground">
        {BRAND.name}
      </span>
    </Link>
  );
}
