"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

interface BillingToggleProps {
  isAnnual: boolean;
  onChange: (annual: boolean) => void;
  className?: string;
}

/**
 * Monthly / annual switch. Not rendered anywhere yet: there are no annual prices.
 * The saving-percentage claim was removed; add a saving line only when the owner confirms annual prices.
 */
export function BillingToggle({ isAnnual, onChange, className }: BillingToggleProps) {
  return (
    <div className={cn("flex items-center justify-center gap-4", className)}>
      <ToggleGroup
        value={[isAnnual ? "annual" : "monthly"]}
        onValueChange={(v) => {
          if (v && v.length > 0) onChange(v[0] === "annual");
        }}
        className="rounded-full border border-border bg-muted/60 min-h-11 p-1"
        spacing={0}
      >
        <ToggleGroupItem
          value="monthly"
          className="rounded-full px-6 py-2 h-9 data-[pressed]:bg-card data-[pressed]:shadow-sm data-[state=on]:bg-card data-[state=on]:shadow-sm transition-all"
        >
          Monthly
        </ToggleGroupItem>
        <ToggleGroupItem
          value="annual"
          className="rounded-full px-6 py-2 h-9 data-[pressed]:bg-card data-[pressed]:shadow-sm data-[state=on]:bg-card data-[state=on]:shadow-sm transition-all"
        >
          Annual
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
