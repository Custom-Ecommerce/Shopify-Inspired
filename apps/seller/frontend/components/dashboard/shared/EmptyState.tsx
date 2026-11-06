import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * EmptyState — blueprint §2.7 / §4.7.
 *
 * Flat tinted panel (bg-muted/30) instead of the old dashed Card.
 * Icon sits in a hairline-bordered tile; title uses font-heading.
 *
 * Props are backward-compatible: (title, description, icon, action, className).
 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl bg-muted/30 px-4 py-16 text-center",
        className
      )}
    >
      {/* Icon tile */}
      <span
        className="flex size-14 items-center justify-center rounded-2xl border bg-card text-muted-foreground"
        aria-hidden="true"
      >
        {icon ?? <Inbox className="size-7" strokeWidth={1.5} />}
      </span>

      {/* Title */}
      <div className="max-w-xs">
        <h3 className="font-heading text-lg font-semibold text-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Action */}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
