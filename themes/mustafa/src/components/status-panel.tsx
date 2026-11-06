import type { ReactNode } from "react";
import { cn } from "./ui/cn";

export interface StatusPanelProps {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** The whole page for a state with nothing to list: a missing page, an empty cart, a confirmation. */
export function StatusPanel({ title, icon, children, action, className }: StatusPanelProps) {
  return (
    <main
      className={cn(
        "mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-16 text-center sm:py-24",
        className,
      )}
    >
      {icon ? <div className="mb-1">{icon}</div> : null}
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {children ? (
        <div className="max-w-md leading-relaxed text-pretty text-(color:--mu-fg-muted)">{children}</div>
      ) : null}
      {action ? <div className="mt-3 flex flex-wrap items-center justify-center gap-3">{action}</div> : null}
    </main>
  );
}
