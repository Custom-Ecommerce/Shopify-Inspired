import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FilterTileProps {
  label: string;
  value: ReactNode;
  hint?: string;
  active: boolean;
  onSelect: () => void;
  valueClassName?: string;
}

export function FilterTile({ label, value, hint, active, onSelect, valueClassName }: FilterTileProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        active && "ring-2 ring-primary border-primary/40",
      )}
    >
      <span className="text-sm font-medium tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("mt-2 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl", valueClassName)}>{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </button>
  );
}
