"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * ErrorState — blueprint §2.7 / §4.7.
 *
 * Re-implemented as a tinted destructive surface instead of the Alert primitive,
 * flat, with a hairline destructive border.
 *
 * Retry button uses the outlined variant (legacy name "clay-soft", renders flat).
 * Props backward-compatible: (message, onRetry, className).
 */
export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl",
        "bg-destructive/8 border border-destructive/20 px-6 py-12 text-center",
        className
      )}
      role="alert"
    >
      <span
        className="flex size-12 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10"
        aria-hidden="true"
      >
        <AlertTriangle className="size-6 text-destructive" strokeWidth={1.5} />
      </span>

      <div className="max-w-sm">
        <h3 className="font-heading text-base font-semibold text-foreground">
          Something went wrong
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>

      {onRetry && (
        <Button variant="clay-soft" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCcw className="size-3.5" aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}
