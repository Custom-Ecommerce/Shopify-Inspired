import { cn } from "@/lib/utils";

interface MockupMetricTileProps {
  label: string;
  value: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  className?: string;
}

/** Decorative metric tile used inside the auth background mockup. */
export function MockupMetricTile({ label, value, trend, className }: MockupMetricTileProps) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-md border border-border bg-background p-4 shadow-xs", className)}>
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="flex items-end justify-between mt-1">
        <span className="text-xl font-bold text-foreground tabular-nums tracking-tight">{value}</span>
        {trend && (
          <span
            className={cn(
              "text-[10px] font-medium tabular-nums",
              trend.isPositive ? "text-success" : "text-destructive"
            )}
          >
            {trend.isPositive ? "+" : "-"}{trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
