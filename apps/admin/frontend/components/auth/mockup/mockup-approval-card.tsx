import { Check, Store } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Auth proof-panel satellite: a store approval landing in the console.
 * Decorative (parent is aria-hidden). Raised, translucent card.
 */
export function MockupApprovalCard({ className }: { className?: string }) {
  return (
    <div className={cn("w-full rounded-2xl border border-border bg-card/90 p-3.5 text-left text-card-foreground shadow-md", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <Store className="size-4 text-primary" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Store approved</p>
          <p className="truncate text-xs text-muted-foreground">Bilyan Traders &middot; Karachi</p>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-success-soft px-2 py-1 text-xs font-medium text-status-success">
          <Check className="size-3" aria-hidden="true" />
          Live
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-xs">
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="text-muted-foreground">Plan</span>
          <span className="font-medium text-foreground">Growth</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="text-muted-foreground">Commission rate</span>
          <span className="font-medium tabular-nums text-foreground">2.5%</span>
        </div>
      </div>
    </div>
  );
}
