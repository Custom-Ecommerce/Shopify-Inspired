import { cn } from "@/lib/utils";

interface MockupMetricTileProps {
  label: string;
  value: string;
  trend?: { value: string; isPositive: boolean };
  className?: string;
}

/** Decorative metric tile used inside the auth proof-panel mockup. */
export function MockupMetricTile({ label, value, trend, className }: MockupMetricTileProps) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-md border border-border bg-background p-3 shadow-xs", className)}>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">{value}</span>
        {trend ? (
          <span className={cn("text-[10px] font-medium tabular-nums", trend.isPositive ? "text-status-success" : "text-destructive")}>
            {trend.isPositive ? "+" : "-"}
            {trend.value}
          </span>
        ) : null}
      </div>
    </div>
  );
}
