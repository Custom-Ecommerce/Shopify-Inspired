import * as React from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "secondary"
  | "outline"
  | "sale"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  sale: "bg-[var(--mu-color-sale)] text-[var(--mu-color-sale-ink)] rounded-[var(--mu-radius-badge)] px-2 py-1 font-semibold uppercase tracking-[0.04em]",
  danger:
    "bg-[var(--mu-color-sale)] text-[var(--mu-color-sale-ink)] rounded-[var(--mu-radius-badge)] px-2 py-1 font-semibold uppercase tracking-[0.04em]",
  primary:
    "bg-[var(--mu-color-ink)] text-[var(--mu-color-ink-inverse)] rounded-[var(--mu-radius-pill)] px-3 py-1 font-medium uppercase tracking-[0.04em]",
  neutral:
    "bg-[#e5e5e5] text-[var(--mu-color-ink)] rounded-[var(--mu-radius-pill)] px-3 py-1 font-medium uppercase tracking-[0.04em]",
  secondary:
    "bg-[var(--mu-color-surface-muted)] text-[var(--mu-color-ink-soft)] border border-[var(--mu-color-line)] rounded-[var(--mu-radius-pill)] px-3 py-1 font-medium",
  outline:
    "bg-transparent text-[var(--mu-color-ink)] border border-[var(--mu-color-line-strong)] rounded-[var(--mu-radius-pill)] px-3 py-1 font-medium",
  accent:
    "bg-[var(--mu-color-brand-soft)] text-[var(--mu-color-brand-text)] rounded-[var(--mu-radius-pill)] px-3 py-1 font-semibold",
  success:
    "bg-[var(--mu-color-brand-soft)] text-[var(--mu-color-brand-text)] rounded-[var(--mu-radius-pill)] px-3 py-1 font-semibold",
  warning:
    "bg-[var(--mu-color-warning-surface)] text-[var(--mu-color-warning)] rounded-[var(--mu-radius-pill)] px-3 py-1 font-semibold",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, variant, children, ...props }, ref) => {
    const resolvedTone: BadgeTone = tone ?? variant ?? "neutral";

    return (
      <span
        ref={ref}
        data-tone={resolvedTone}
        className={cn(
          "inline-flex items-center justify-center font-[family-name:var(--mu-font-family-stack)]",
          "text-[length:var(--mu-text-xs)] leading-none whitespace-nowrap select-none",
          toneClasses[resolvedTone] ?? toneClasses.neutral,
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";
