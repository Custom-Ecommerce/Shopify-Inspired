import { Wallet } from "lucide-react";
import { Surface } from "@/components/shared/Surface";
import { cn } from "@/lib/utils";

/**
 * Auth proof-panel satellite: a local wallet payment landing.
 * Pill-shaped L3 surface. Decorative — parent is aria-hidden.
 * Ported from storefront marketing/mockup/payment-chip.tsx.
 */
export function MockupPaymentChip({ className }: { className?: string }) {
  return (
    <Surface
      level={3}
      radius="full"
      translucent
      className={cn("flex items-center gap-3 py-2 pl-2 pr-5 text-left", className)}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
        <Wallet className="size-4 text-primary-foreground dark:text-primary" aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-col">
        <span className="whitespace-nowrap text-xs text-muted-foreground">EasyPaisa payment received</span>
        <span className="flex items-center gap-2 text-sm font-semibold tabular-nums text-foreground">
          Rs. 4,250
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
        </span>
      </div>
    </Surface>
  );
}
