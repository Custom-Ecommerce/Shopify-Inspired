"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { canUse } from "@/lib/role-access";
import { bannerNeedsAction, bannerText, readPlanUsage, usageBars, type BarTone, type PlanUsageData } from "@/lib/plan-usage";
import { cn } from "@/lib/utils";

const FILL: Record<BarTone, string> = { ok: "bg-primary", near: "bg-warning", full: "bg-warning", over: "bg-destructive" };

/**
 * Sprint 6 EP-14.US02 (D-118): the plan banner with usage bars, on the dashboard and the billing page. It reads /api/dashboard/plan-usage once;
 * if that fails the banner is simply not shown (nothing else on the page depends on it). A stacked layout from 375 px up: the bars are
 * full-width rows, never side by side below the sm breakpoint.
 */
export function PlanBanner({ compact = false }: { compact?: boolean }) {
  const storeFetch = useStoreFetch();
  const [usage, setUsage] = useState<PlanUsageData | null>(null);

  // S8-B4: the plan and billing are the owner's: no other role sees the banner or asks for the usage.
  const showsBilling = canUse(useDashboard().activeStore.role, "billing");

  useEffect(() => {
    if (!showsBilling) return;
    let cancelled = false;
    storeFetch("/api/dashboard/plan-usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (!cancelled) setUsage(readPlanUsage(body));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeFetch, showsBilling]);

  if (!showsBilling || usage === null) return null;
  const text = bannerText(usage);
  const attention = bannerNeedsAction(usage.status);
  const bars = usageBars(usage);

  return (
    <section
      aria-label="Your plan"
      data-slot="plan-banner"
      data-status={usage.status}
      className={cn("rounded-2xl border p-4", attention ? "border-warning/60 bg-warning/10" : "border-border bg-card")}
    >
      <div className="flex items-start gap-3">
        {attention ? <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden /> : <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{text.headline}</p>
          <p className="text-sm text-muted-foreground">{text.detail}</p>
          {usage.storeLimitOverridden ? <p className="mt-1 text-xs text-muted-foreground">Your store limit was set for you by the platform team.</p> : null}
        </div>
      </div>
      {compact ? null : <div className="mt-1" />}
      <ul className={cn("mt-3 flex flex-col gap-3", compact ? "" : "sm:grid sm:grid-cols-2")}>
        {bars.map((bar) => (
          <li key={bar.label} data-slot="usage-bar" data-tone={bar.tone}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{bar.label}</span>
              <span className="tabular-nums text-muted-foreground">{bar.text}</span>
            </div>
            <div
              role="progressbar"
              aria-label={bar.label + " used"}
              aria-valuemin={0}
              aria-valuemax={bar.limit ?? undefined}
              aria-valuenow={bar.used}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className={cn("h-full rounded-full transition-[width]", FILL[bar.tone])} style={{ width: bar.percent + "%" }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
