import { MetricTile } from "./metric-tile";
import { LiveOrders } from "./live-orders";
import { RevenueChart } from "./revenue-chart";
import { cn } from "@/lib/utils";

const PAYMENTS = ["JazzCash", "EasyPaisa", "COD"] as const;
const COURIERS = ["TCS", "Leopards", "Trax"] as const;

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground">
      {children}
    </span>
  );
}

/**
 * ProductMock: a code-built panel of today's orders, payments and couriers.
 * Decorative and aria-hidden. Every value is sample data in PKR.
 */
export function DashboardMockup({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("w-full overflow-hidden rounded-lg border border-border bg-surface-1", className)}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-foreground">Today</span>
        <span className="text-xs text-muted-foreground">Sample data</span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
        <MetricTile label="Orders today" value="24" trend={{ value: "8%", isPositive: true }} />
        <MetricTile label="WhatsApp verified" value="21 of 24" />
      </div>

      <RevenueChart className="border-b border-border" />

      <LiveOrders className="border-b border-border" />

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Payments</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PAYMENTS.map((name) => (
              <Chip key={name}>{name}</Chip>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Couriers</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {COURIERS.map((name) => (
              <Chip key={name}>{name}</Chip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { DashboardMockup as ProductMock };
