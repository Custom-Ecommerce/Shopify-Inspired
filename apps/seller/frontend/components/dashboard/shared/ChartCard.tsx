"use client";

import type { ReactNode } from "react";
import { Surface } from "@/components/shared/Surface";
import { cn } from "@/lib/utils";

/**
 * ChartCard — blueprint §5.4.
 *
 * A flat level-2 card that wraps any Recharts chart.
 *
 * Structure:
 *  Surface (level 2, rounded-2xl, overflow-hidden)
 *    ├─ Header: title + muted description + optional period selector slot
 *    └─ Body: subtle muted plot tray
 *               └─ {children} — ChartContainer + Recharts chart
 *
 * Rules (blueprint §5.4):
 *  - The plot tray is a faint bg-muted/30 panel; the chart lines themselves stay flat.
 *  - Recharts internals are NOT touched — we only wrap the container.
 *  - Header period tabs: use Tabs primitive styled as a segmented control,
 *    passed via the `periodSelector` slot.
 *  - Chart height defaults to aspect-video. Override with `chartHeight`.
 *  - Empty / loading states: pass via `emptyState` / `loadingState` instead of children.
 */
interface ChartCardProps {
  title: string;
  description?: string;
  /** Right-aligned header slot — period <Tabs> segmented control. */
  periodSelector?: ReactNode;
  /** Inner padding on the chart tray. Defaults to "p-4 sm:p-5". */
  trayClassName?: string;
  children: ReactNode;
  className?: string;
}

export function ChartCard({
  title,
  description,
  periodSelector,
  trayClassName,
  children,
  className,
}: ChartCardProps) {
  return (
    <Surface variant="clay" level={2} radius="2xl" className={cn("overflow-hidden", className)}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          {/* Card title (font-heading = Poppins) */}
          <h2 className="font-heading text-base font-semibold tracking-tight text-foreground sm:text-lg">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {periodSelector && (
          <div className="shrink-0">{periodSelector}</div>
        )}
      </div>

      {/* ── Plot tray ──────────────────────────────────────────────────── */}
      {/* Plot tray: faint muted panel, padded on all sides inside the card. */}
      <div className="p-4 sm:p-5">
        <div className={cn("rounded-xl bg-muted/30", trayClassName ?? "p-4 sm:p-5")}>
          {children}
        </div>
      </div>
    </Surface>
  );
}
