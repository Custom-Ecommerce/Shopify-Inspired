import * as React from "react";
import { cn } from "./cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "muted" | "strong" | "cream" | "mint" | "sky";
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const variantClasses: Record<NonNullable<CardProps["variant"]>, string> = {
  default:
    "bg-[var(--mu-color-surface)] text-[var(--mu-color-ink)] border border-[var(--mu-color-line)]",
  muted:
    "bg-[var(--mu-color-surface-muted)] text-[var(--mu-color-ink)] border border-[var(--mu-color-line)]",
  strong:
    "bg-[var(--mu-color-surface-inverse)] text-[var(--mu-color-ink-inverse)] border border-[var(--mu-color-surface-inverse)]",
  cream:
    "bg-[var(--mu-color-tile-cream)] text-[var(--mu-color-ink)] border border-transparent",
  mint:
    "bg-[var(--mu-color-tile-mint)] text-[var(--mu-color-ink)] border border-transparent",
  sky:
    "bg-[var(--mu-color-tile-sky)] text-[var(--mu-color-ink)] border border-transparent",
};

const paddingClasses: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      variant = "default",
      interactive = false,
      padding = "md",
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        "font-[family-name:var(--mu-font-family-stack)] rounded-[var(--mu-radius-card)] overflow-hidden",
        "transition-colors duration-[var(--mu-motion-duration-instant)]",
        variantClasses[variant],
        paddingClasses[padding],
        interactive && [
          "hover:border-[var(--mu-color-ink-soft)]",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--mu-color-focus)]",
        ],
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1.5 pb-3", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "font-[family-name:var(--mu-font-family-stack)] text-[length:var(--mu-text-h3)] font-normal leading-snug text-[var(--mu-color-ink)]",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "font-[family-name:var(--mu-font-family-stack)] text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-muted)] leading-normal",
      className
    )}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-[length:var(--mu-text-body)]", className)}
    {...props}
  />
));
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center gap-3 pt-4", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";
