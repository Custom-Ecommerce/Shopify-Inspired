import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Auth proof-panel satellite: catalog sync health.
 * Pill-shaped, translucent. Decorative: parent is aria-hidden.
 */
export function MockupSyncChip({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-full border border-border bg-card/90 py-2 pl-2 pr-5 text-left text-card-foreground shadow-md", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
        <RefreshCw className="size-4 text-primary" aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-col">
        <span className="whitespace-nowrap text-xs text-muted-foreground">Catalog sync healthy</span>
        <span className="flex items-center gap-2 text-sm font-semibold tabular-nums text-foreground">
          0 pending
          <span className="size-2 rounded-full bg-status-success" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
