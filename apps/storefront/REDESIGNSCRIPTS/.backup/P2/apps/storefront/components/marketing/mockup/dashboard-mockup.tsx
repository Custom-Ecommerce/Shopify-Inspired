import { MetricTile } from "./metric-tile";
import { LiveOrders } from "./live-orders";
import { RevenueChart } from "./revenue-chart";
import { cn } from "@/lib/utils";

export function DashboardMockup({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative mx-auto w-full", className)}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        <div className="flex flex-col gap-4 md:col-span-2 md:gap-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <MetricTile
              label="Total Store Visitors"
              value="12,482"
              trend={{ value: "12%", isPositive: true }}
            />
            <MetricTile
              label="Conversion Rate"
              value="3.2%"
              trend={{ value: "0.4%", isPositive: true }}
            />
          </div>
          <RevenueChart className="flex-1" />
        </div>

        <div className="md:col-span-1">
          <LiveOrders className="h-full" />
        </div>
      </div>
    </div>
  );
}
