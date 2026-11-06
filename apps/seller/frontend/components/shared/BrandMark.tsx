import { cn } from "@/lib/utils";
import Link from "next/link";
import React from "react";

/**
 * BrandMark: primary tile "M" + Poppins wordmark.
 *
 * Blueprint §3.2: appears in AuthShell top bar (left) and AppSidebar header.
 * Collapses to the "M" tile only when the sidebar is in icon mode (hide the
 * <span> via sr-only or conditional render in AppSidebar).
 */
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
      aria-label="Markazify Home"
      {...props}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-lg font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        M
      </div>
      <span className="font-heading text-xl font-semibold tracking-tight text-foreground">
        Markazify
      </span>
    </Link>
  );
}
