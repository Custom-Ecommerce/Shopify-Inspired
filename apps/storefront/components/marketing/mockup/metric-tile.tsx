import { cn } from "@/lib/utils";

interface MetricTileProps {
  label: string;
  value: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  className?: string;
}

export function MetricTile({ label, value, trend, className }: MetricTileProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 p-4", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              trend.isPositive ? "text-success-subtle-foreground" : "text-destructive-subtle-foreground"
            )}
          >
            {trend.isPositive ? "+" : "-"}{trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
