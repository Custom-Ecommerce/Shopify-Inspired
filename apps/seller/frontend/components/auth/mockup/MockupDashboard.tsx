import { Surface } from "@/components/shared/Surface";
import { GlowHalo } from "@/components/shared/GlowHalo";
import { MockupMetricTile } from "./MockupMetricTile";
import { MockupLiveOrders } from "./MockupLiveOrders";
import { MockupRevenueChart } from "./MockupRevenueChart";
import { cn } from "@/lib/utils";

/**
 * Auth proof-panel floating dashboard mockup.
 * Ported from storefront FloatingDashboardMockup — seller-local copy.
 *
 * Decorative: the parent AuthProofPanel is aria-hidden.
 * Tilt / float / satellites are owned by IsoStage + FloatLayer + AuthProofPanel.
 */
export function MockupDashboard({ className }: { className?: string }) {
  return (
    <div className={cn("relative isolate w-full", className)}>
      <GlowHalo shape="rect" radius="3xl" inset="normal" intensity="soft" />

      <Surface level={4} radius="2xl" className="overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <div className="size-2.5 rounded-full bg-destructive/70" />
          <div className="size-2.5 rounded-full bg-primary/70" />
          <div className="size-2.5 rounded-full bg-success/70" />
          <div className="ml-4 flex h-6 w-48 items-center justify-center rounded-md border border-border bg-card px-3 sm:w-64">
            <span className="truncate text-[11px] text-muted-foreground">markazify.com/store/bilyan</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3 md:gap-6 md:p-6">
          <div className="flex flex-col gap-4 md:col-span-2 md:gap-6">
            <div className="grid grid-cols-2 gap-4">
              <MockupMetricTile label="Total Visitors" value="12,482" trend={{ value: "12%", isPositive: true }} />
              <MockupMetricTile label="Conversion Rate" value="3.2%" trend={{ value: "0.4%", isPositive: true }} />
            </div>
            <MockupRevenueChart className="flex-1" />
          </div>

          {/* Hidden on mobile */}
          <div className="hidden md:col-span-1 md:block">
            <MockupLiveOrders className="h-full" />
          </div>
        </div>
      </Surface>
    </div>
  );
}
