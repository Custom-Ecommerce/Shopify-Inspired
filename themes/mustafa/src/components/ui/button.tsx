import * as React from "react";
import { cn } from "./cn";
import { Spinner } from "./spinner";

export type ButtonVariant =
  | "primary"
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "destructive"
  | "link";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonVariantsOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    "bg-[var(--mu-color-ink)] text-[var(--mu-color-ink-inverse)]",
    "border border-[var(--mu-color-ink)]",
    "hover:bg-[var(--mu-color-surface-base)] hover:border-[var(--mu-color-surface-base)]",
    "active:scale-[0.98]",
    "disabled:bg-[var(--mu-color-line)] disabled:border-[var(--mu-color-line)] disabled:text-[var(--mu-color-ink-muted)]",
  ].join(" "),
  default: [
    "bg-[var(--mu-color-ink)] text-[var(--mu-color-ink-inverse)]",
    "border border-[var(--mu-color-ink)]",
    "hover:bg-[var(--mu-color-surface-base)] hover:border-[var(--mu-color-surface-base)]",
    "active:scale-[0.98]",
    "disabled:bg-[var(--mu-color-line)] disabled:border-[var(--mu-color-line)] disabled:text-[var(--mu-color-ink-muted)]",
  ].join(" "),
  outline: [
    "bg-transparent text-[var(--mu-color-ink)]",
    "border border-[var(--mu-color-line-strong)]",
    "hover:bg-[var(--mu-color-ink)] hover:text-[var(--mu-color-ink-inverse)]",
    "active:scale-[0.98]",
    "disabled:border-[var(--mu-color-line)] disabled:text-[var(--mu-color-ink-muted)] disabled:bg-transparent",
  ].join(" "),
  secondary: [
    "bg-[var(--mu-color-surface-muted)] text-[var(--mu-color-ink)]",
    "border border-[var(--mu-color-line)]",
    "hover:border-[var(--mu-color-line-strong)] hover:bg-[var(--mu-color-tile-cream)]",
    "active:scale-[0.98]",
    "disabled:bg-[var(--mu-color-line)] disabled:text-[var(--mu-color-ink-muted)]",
  ].join(" "),
  ghost: [
    "bg-transparent text-[var(--mu-color-ink)]",
    "border border-transparent",
    "hover:bg-[var(--mu-color-surface-muted)] hover:text-[var(--mu-color-brand-text)]",
  ].join(" "),
  danger: [
    "bg-[var(--mu-color-sale)] text-[var(--mu-color-sale-ink)]",
    "border border-[var(--mu-color-sale)]",
    "hover:opacity-90 active:scale-[0.98]",
  ].join(" "),
  destructive: [
    "bg-[var(--mu-color-sale)] text-[var(--mu-color-sale-ink)]",
    "border border-[var(--mu-color-sale)]",
    "hover:opacity-90 active:scale-[0.98]",
  ].join(" "),
  link: [
    "bg-transparent text-[var(--mu-color-ink)] underline underline-offset-4 decoration-1",
    "hover:text-[var(--mu-color-brand-text)] border-transparent px-0 h-auto min-h-0",
  ].join(" "),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-[40px] h-10 px-4 text-[length:var(--mu-text-small)] gap-1.5 rounded-[var(--mu-radius-pill)]",
  md: "min-h-[48px] h-12 px-6 text-[length:var(--mu-text-body)] gap-2 rounded-[var(--mu-radius-pill)]",
  lg: "min-h-[52px] h-13 px-7 text-[length:var(--mu-text-body)] gap-2.5 rounded-[var(--mu-radius-pill)]",
  icon: "min-h-[44px] min-w-[44px] h-11 w-11 p-0 rounded-[var(--mu-radius-pill)]",
};

export function buttonVariants(options: ButtonVariantsOptions = {}): string {
  const {
    variant = "primary",
    size = "md",
    fullWidth = false,
    className,
  } = options;

  return cn(
    "inline-flex items-center justify-center font-[family-name:var(--mu-font-family-stack)] font-medium leading-none",
    "select-none whitespace-nowrap cursor-pointer touch-manipulation",
    "transition-all duration-[var(--mu-motion-duration-instant)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mu-color-focus)]",
    "disabled:pointer-events-none disabled:cursor-not-allowed",
    variantClasses[variant] ?? variantClasses.primary,
    sizeClasses[size] ?? sizeClasses.md,
    fullWidth && "w-full",
    className
  );
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  isLoading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      isLoading = false,
      disabled = false,
      fullWidth = false,
      type = "button",
      children,
      ...props
    },
    ref
  ) => {
    const busy = loading || isLoading;
    const isDisabled = disabled || busy;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={busy || undefined}
        aria-disabled={isDisabled || undefined}
        data-variant={variant}
        data-size={size}
        className={buttonVariants({ variant, size, fullWidth, className })}
        {...props}
      >
        {busy && <Spinner className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="inline-flex items-center justify-center gap-2 truncate">
          {children}
        </span>
      </button>
    );
  }
);

Button.displayName = "Button";
