import { cn } from "@/lib/utils";
import Link from "next/link";
import React from "react";

export function BrandMark({
  className,
  href = "/",
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & { href?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      aria-label="Markazify Admin Home"
      {...props}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-lg font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        M
      </div>
      <span className="font-heading text-xl font-semibold tracking-tight text-foreground">
        Markazify <span className="text-muted-foreground text-sm font-normal">Admin</span>
      </span>
    </Link>
  );
}
