import type { ReactNode } from "react";
import { cn } from "./cn";
import { AlertIcon } from "./icons";

/**
 * The aria-describedby value for a control: the ids of the hint and the error, when each is shown.
 * Field renders both with these ids, so the reference always resolves.
 */
export function fieldDescribedBy(id: string, hint?: string | null, error?: string | null): string | undefined {
  const ids: string[] = [];
  if (hint) ids.push(id + "-hint");
  if (error) ids.push(id + "-error");
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

/** A label, its control, and the hint and error text that describe it. */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-(color:--mu-fg)">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={id + "-hint"} className="text-sm leading-relaxed text-(color:--mu-fg-muted)">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={id + "-error"} className="flex items-start gap-1.5 text-sm leading-relaxed text-(color:--mu-danger)">
          <AlertIcon className="mt-0.5 size-4" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
