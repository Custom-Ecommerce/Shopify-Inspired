import * as React from "react";
import { cn } from "./cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  error?: boolean;
  pill?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, invalid, error, disabled, pill = true, type = "text", ...props },
    ref
  ) => {
    const isInvalid = Boolean(invalid || error || props["aria-invalid"]);

    return (
      <input
        ref={ref}
        type={type}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        className={cn(
          "flex w-full min-h-[44px] h-11 font-[family-name:var(--mu-font-family-stack)]",
          "px-5 py-2.5 text-[length:var(--mu-text-body)] leading-normal",
          "bg-[var(--mu-color-surface)] text-[var(--mu-color-ink)]",
          pill
            ? "rounded-[var(--mu-radius-input)]"
            : "rounded-[var(--mu-radius-sm)]",
          "border border-[var(--mu-color-line)]",
          "placeholder:text-[var(--mu-color-ink-muted)]",
          "transition-colors duration-[var(--mu-motion-duration-instant)]",
          "hover:border-[var(--mu-color-ink-soft)]",
          "focus-visible:border-[var(--mu-color-line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mu-color-focus)]",
          "disabled:cursor-not-allowed disabled:bg-[var(--mu-color-surface-muted)] disabled:text-[var(--mu-color-ink-muted)]",
          isInvalid &&
            "border-[var(--mu-color-sale)] focus-visible:border-[var(--mu-color-sale)] focus-visible:outline-[var(--mu-color-sale)]",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, error, disabled, rows = 3, ...props }, ref) => {
    const isInvalid = Boolean(invalid || error || props["aria-invalid"]);

    return (
      <textarea
        ref={ref}
        rows={rows}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        className={cn(
          "flex w-full min-h-[96px] font-[family-name:var(--mu-font-family-stack)]",
          "px-4 py-3 text-[length:var(--mu-text-body)] leading-relaxed",
          "bg-[var(--mu-color-surface)] text-[var(--mu-color-ink)]",
          "rounded-[var(--mu-radius-card)] border border-[var(--mu-color-line)]",
          "placeholder:text-[var(--mu-color-ink-muted)]",
          "transition-colors duration-[var(--mu-motion-duration-instant)]",
          "hover:border-[var(--mu-color-ink-soft)]",
          "focus-visible:border-[var(--mu-color-line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mu-color-focus)]",
          "disabled:cursor-not-allowed disabled:bg-[var(--mu-color-surface-muted)] disabled:text-[var(--mu-color-ink-muted)]",
          isInvalid &&
            "border-[var(--mu-color-sale)] focus-visible:border-[var(--mu-color-sale)] focus-visible:outline-[var(--mu-color-sale)]",
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
