import { Check, MessageCircle } from "lucide-react";
import { Surface } from "@/components/shared/Surface";
import { cn } from "@/lib/utils";

/**
 * Auth proof-panel satellite: a COD order confirmed over WhatsApp.
 * Decorative (parent is aria-hidden). L3 surface, translucent.
 * Ported from storefront marketing/mockup/order-notification-card.tsx.
 */
export function MockupOrderCard({ className }: { className?: string }) {
  return (
    <Surface level={3} radius="2xl" translucent className={cn("w-full p-3.5 text-left", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <MessageCircle className="size-4 text-primary-foreground dark:text-primary" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">New COD order</p>
          <p className="truncate text-xs text-muted-foreground">
            via WhatsApp &middot; <span className="tabular-nums">Rs. 6,400</span>
          </p>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success">
          <Check className="size-3" aria-hidden="true" />
          Confirmed
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-xs">
        <p className="max-w-[85%] rounded-2xl rounded-tl-md border border-border bg-muted/40 px-3 py-2 text-foreground">
          Confirm your order? Reply YES
        </p>
        <p className="ml-auto w-fit rounded-2xl rounded-tr-md bg-primary px-3 py-2 font-medium text-primary-foreground">
          YES
        </p>
      </div>
    </Surface>
  );
}
