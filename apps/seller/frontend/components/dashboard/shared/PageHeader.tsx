import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary action: use <Button> (default variant) */
  children?: ReactNode;
  className?: string;
}

/**
 * PageHeader — blueprint §4.6 / §5.1.
 *
 * Title: Poppins (font-heading), text-2xl to 3xl, bold.
 * Description: Poppins, text-sm, muted-foreground.
 * Actions: right-aligned slot. Primary = default, secondary = outline.
 *
 * Pages stop adding their own mb-* once they use this — spacing is standardised.
 */
export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        {/* font-heading resolves to Poppins via the theme token */}
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2 sm:mt-1">
          {children}
        </div>
      )}
    </div>
  );
}
