import type { ReactNode, ElementType } from "react";
import { Surface } from "@/components/shared/Surface";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * MetricTile — blueprint §5.3. Replaces the inline StatCard on the Overview page.
 *
 * Anatomy (flat card, rounded-2xl, hairline border):
 * ┌──────────────────────────────────┐
 * │ Label                    (icon)  │  icon in a tinted tile: primary tint
 * │                                  │  (hero metric) or muted (neutral)
 * │ PKR 482,900                      │  value: Poppins, tabular-nums
 * │ ▲ 8.2%  vs last month           │  delta pill
 * └──────────────────────────────────┘
 *
 * Rules:
 *  - Hero metric: coinVariant="brand" → bg-primary/10 tile with a primary icon
 *  - All others: coinVariant="neutral" → bg-muted tile
 *  - lift=true on clickable tiles (links to filtered list page)
 *  - Delta pill: text-success / text-destructive on /15 tint
 *  - If no delta data: omit the delta line entirely (no fabricated numbers)
 *  - Loading: Skeleton with same footprint; zero state: "—" not "0"
 */

interface DeltaProps {
  value: string;
  label?: string;
  direction: "up" | "down" | "flat";
}

interface MetricTileProps {
  label: string;
  value: string | number;
  icon?: ElementType;
  /** "brand" for the hero metric (Revenue), "neutral" for all others. */
  coinVariant?: "brand" | "neutral";
  delta?: DeltaProps;
  /** Render the tile as a link (gives it lift hover). Pass the href. */
  href?: string;
  className?: string;
  /** Extra action slot (e.g. small secondary link). */
  action?: ReactNode;
}

function DeltaPill({ value, label, direction }: DeltaProps) {
  const Icon =
    direction === "up"
      ? TrendingUp
      : direction === "down"
      ? TrendingDown
      : Minus;

  const colorClass =
    direction === "up"
      ? "text-success bg-success/15"
      : direction === "down"
      ? "text-destructive bg-destructive/15"
      : "text-muted-foreground bg-muted";

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
          colorClass
        )}
      >
        <Icon className="size-3" aria-hidden="true" />
        {direction === "up" ? "+" : direction === "down" ? "-" : ""}
        {value}
      </span>
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  icon: Icon,
  coinVariant = "neutral",
  delta,
  href,
  className,
  action,
}: MetricTileProps) {
  const displayValue = value === 0 || value === "" ? "—" : value;

  const content = (
    <>
      {/* Header row: label left, icon coin right */}
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium tracking-wide text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              coinVariant === "brand" ? "bg-primary/10" : "bg-muted"
            )}
            aria-hidden="true"
          >
            <Icon
              className={cn(
                "size-4",
                coinVariant === "brand" ? "text-primary" : "text-foreground"
              )}
            />
          </span>
        )}
      </div>

      {/* Value */}
      <div className="mt-3 font-sans text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
        {displayValue}
      </div>

      {/* Delta */}
      {delta && (
        <DeltaPill
          value={delta.value}
          label={delta.label}
          direction={delta.direction}
        />
      )}

      {/* Extra action */}
      {action && <div className="mt-3">{action}</div>}
    </>
  );

  // Clickable variant: render as a Surface with lift
  if (href) {
    return (
      <Surface
        as="a"
        variant="clay"
        level={2}
        radius="2xl"
        lift
        href={href}
        className={cn("block p-5 no-underline", className)}
      >
        {content}
      </Surface>
    );
  }

  return (
    <Surface variant="clay" level={2} radius="2xl" className={cn("p-5", className)}>
      {content}
    </Surface>
  );
}
