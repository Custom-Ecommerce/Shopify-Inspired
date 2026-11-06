import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  message?: string;
  className?: string;
  /**
   * "spinner"  — simple centred spinner (default; for small inline fetches).
   * "skeleton" — table-shaped skeleton rows (use for full-page route loading.tsx).
   */
  variant?: "spinner" | "skeleton";
  /** Number of skeleton rows to render (only used when variant="skeleton"). */
  rows?: number;
}

/**
 * LoadingState — blueprint §2.7 / §4.7.
 *
 * Two variants:
 *  - "spinner"  : keeps existing behaviour (backward compat). Inline spinner
 *                 for client-side data fetches (useDashboardData refresh etc).
 *  - "skeleton" : shaped skeleton rows for route-level loading.tsx files
 *                 (avoids layout shift per blueprint §4.7).
 *
 * Poppins font-medium for the message (drops old font-mono).
 */
export function LoadingState({
  message = "Loading…",
  className = "",
  variant = "spinner",
  rows = 5,
}: LoadingStateProps) {
  if (variant === "skeleton") {
    return (
      <div className={cn("flex flex-col gap-3 py-4", className)}>
        {/* Header-shaped skeleton */}
        <Skeleton className="h-8 w-48 rounded-xl" />
        {/* Metric tile row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        {/* Table-shaped skeletons */}
        <Skeleton className="mt-2 h-10 w-full rounded-2xl" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-2xl opacity-60" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground",
        className
      )}
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}
