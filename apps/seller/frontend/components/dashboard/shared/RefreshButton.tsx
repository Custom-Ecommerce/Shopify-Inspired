"use client";

import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDashboardData } from "@/lib/dashboard-data-context";

/**
 * RefreshButton — blueprint §2.8.
 *
 * Outlined icon button (legacy variant name "clay-soft", renders flat).
 * No change to the data-layer hook (useDashboardData) — purely presentational.
 */
export function RefreshButton() {
  const { refresh, isRefreshing } = useDashboardData();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="clay-soft"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label="Refresh data"
            aria-busy={isRefreshing}
          />
        }
      >
        {isRefreshing ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-4" aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipContent>Refresh data</TooltipContent>
    </Tooltip>
  );
}
