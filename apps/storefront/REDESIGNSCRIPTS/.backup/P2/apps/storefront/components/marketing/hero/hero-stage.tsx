/* @markaz/storefront:phase2a-flat-hero-stage */
import * as React from "react";
import { ShoppingBag, Check } from "lucide-react";
import { Surface } from "@/components/shared/surface";
import { DashboardMockup } from "@/components/marketing/mockup/dashboard-mockup";
import { BRAND } from "@/lib/brand";

function HeroPhoneStorefront() {
  return (
    <Surface
      level={3}
      radius="3xl"
      className="w-full overflow-hidden border border-border-strong bg-card p-2 shadow-lg"
    >
      <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-border" />
      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        {/* Phone store header */}
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
          <span className="truncate text-[11px] font-semibold text-foreground">
            Demo Store
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <ShoppingBag className="size-2.5" aria-hidden="true" />
            2
          </span>
        </div>

        {/* Featured product card */}
        <div className="p-2.5 space-y-2.5">
          <div className="rounded-xl border border-border bg-muted/50 p-2.5">
            <div className="mb-2 flex h-16 items-center justify-center rounded-lg bg-primary/10">
              <div className="h-8 w-12 rounded-md border border-primary/25 bg-card" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-foreground">
                Lawn Kurta Set
              </span>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
                Rs. 3,450
              </span>
            </div>
          </div>

          {/* Payment badges */}
          <div className="flex flex-wrap gap-1">
            <span className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              COD
            </span>
            <span className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              JazzCash
            </span>
            <span className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              EasyPaisa
            </span>
          </div>

          {/* Order button */}
          <div className="flex items-center justify-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground">
            <Check className="size-3" aria-hidden="true" />
            Order with COD
          </div>
        </div>
      </div>
    </Surface>
  );
}

export function HeroStage() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-5xl md:pb-8">
      <Surface
        level={3}
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="size-2.5 rounded-full bg-destructive/70 sm:size-3" />
            <div className="size-2.5 rounded-full bg-warning/70 sm:size-3" />
            <div className="size-2.5 rounded-full bg-success/70 sm:size-3" />
          </div>
          <div className="min-w-0 truncate rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:px-3">
            {BRAND.adminPreviewUrl}
          </div>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sample data</span>
        </div>
        <div className="bg-background p-3 sm:p-6 md:pb-10">
          <DashboardMockup />
        </div>
      </Surface>

      {/* Phone storefront mockup: overlaps bottom-right corner on md+, hidden below md to keep mobile first screen compact and 360px-safe */}
      <div className="hidden md:block md:absolute md:-bottom-2 md:right-4 md:z-20 md:w-56 lg:right-6 lg:w-60 motion-float">
        <HeroPhoneStorefront />
      </div>
    </div>
  );
}
