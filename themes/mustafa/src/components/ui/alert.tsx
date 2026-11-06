import type { HTMLAttributes } from "react";
import { cn } from "./cn";
import { AlertIcon, CheckIcon } from "./icons";

export type AlertTone = "neutral" | "success" | "danger";

const TONES: Record<AlertTone, string> = {
  neutral: "border-(--mu-border) bg-(--mu-surface-muted)",
  success: "border-transparent bg-(--mu-success-bg)",
  danger: "border-transparent bg-(--mu-danger-bg)",
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
}

/**
 * An inline message. Danger alerts announce as alerts. Everything else is a polite status message.
 * Pass role to override either.
 */
export function Alert({ tone = "neutral", role, className, children, ...props }: AlertProps) {
  return (
    <div
      {...props}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "flex gap-3 rounded-(--mu-radius) border p-3.5 text-sm leading-relaxed text-(color:--mu-fg)",
        TONES[tone],
        className,
      )}
    >
      {tone === "danger" ? <AlertIcon className="mt-0.5 size-4 text-(color:--mu-danger)" /> : null}
      {tone === "success" ? <CheckIcon className="mt-0.5 size-4 text-(color:--mu-success)" /> : null}
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={cn("font-semibold", className)} />;
}
