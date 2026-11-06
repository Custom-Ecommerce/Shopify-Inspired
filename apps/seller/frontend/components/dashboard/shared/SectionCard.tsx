import type { ReactNode } from "react";
import { Surface } from "@/components/shared/Surface";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Remove inner padding — use for tables, code blocks, or full-bleed content. */
  noPadding?: boolean;
  /** Header right-aligned slot — actions, badges, or period selectors. */
  headerAction?: ReactNode;
}

/**
 * SectionCard — blueprint §2.2 / §5.1.
 *
 * Built on Surface (level 2, radius "2xl"): hairline border, plain card fill,
 * stock shadow-sm. Replaces the old Card primitive.
 *
 * Props are backward-compatible with the old SectionCard:
 *  title, children, className, noPadding — all preserved.
 * New additions: description, headerAction.
 */
export function SectionCard({
  title,
  description,
  children,
  className,
  noPadding = false,
  headerAction,
}: SectionCardProps) {
  return (
    <Surface variant="clay" level={2} radius="2xl" className={cn("overflow-hidden", className)}>
      {(title || headerAction) && (
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            {title && (
              /* Card title (font-heading = Poppins) */
              <h2 className="font-heading text-base font-semibold tracking-tight text-foreground sm:text-lg">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {headerAction && (
            <div className="shrink-0">{headerAction}</div>
          )}
        </div>
      )}
      <div className={noPadding ? "" : "px-5 py-4 sm:px-6 sm:py-5"}>
        {children}
      </div>
    </Surface>
  );
}
