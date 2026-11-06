import { cn } from "@/lib/utils";
import { MockupMetricTile } from "./mockup-metric-tile";
import { MockupReviewQueue } from "./mockup-review-queue";
import { MockupRevenueChart } from "./mockup-revenue-chart";

/**
 * Auth proof-panel floating console mockup.
 * Decorative: the parent AuthProofPanel is aria-hidden. Tilt, float and satellites
 * are owned by IsoStage + FloatLayer + AuthProofPanel. The panel only renders at lg+,
 * so this mockup uses one fixed layout with no breakpoints.
 */
export function MockupDashboard({ className }: { className?: string }) {
  return (
    <div className={cn("relative isolate w-full", className)}>
      {/* Glow shaped like the card it sits behind */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-3 -z-10 rounded-3xl bg-primary/15 opacity-70 blur-2xl dark:bg-primary/25" />

      <div className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <div className="size-2.5 rounded-full bg-destructive/70" />
          <div className="size-2.5 rounded-full bg-primary/70" />
          <div className="size-2.5 rounded-full bg-status-success/70" />
          <div className="ml-4 flex h-6 w-56 items-center justify-center rounded-md border border-border bg-card px-3">
            <span className="truncate text-[11px] text-muted-foreground">admin.markazify.com/overview</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 p-4">
          <div className="col-span-2 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <MockupMetricTile label="Active stores" value="1,248" trend={{ value: "3.1%", isPositive: true }} />
              <MockupMetricTile label="Commission MTD" value="Rs. 312K" trend={{ value: "8.4%", isPositive: true }} />
            </div>
            <MockupRevenueChart className="flex-1" />
          </div>
          <div className="col-span-1">
            <MockupReviewQueue className="h-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
