import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Surface: the single source of truth for card-like containers.
 *
 * Flat "Rose" style (Inspired UI): hairline border, plain card fill, stock
 * Tailwind shadows. Levels only change how much shadow a surface carries:
 *
 *  1  resting   border-border
 *  2  raised    border-border + shadow-sm
 *  3  featured  border-border + shadow-md
 *  4  hero      border-border + shadow-lg
 *
 * `lift` makes a surface interactive: on hover/focus the border picks up the
 * brand colour and the shadow grows to shadow-md. No movement.
 *
 * variant="clay" is a legacy alias kept so existing call sites compile; it
 * renders exactly like "layer".
 */
export type SurfaceLevel = 1 | 2 | 3 | 4;
export type SurfaceRadius = "xl" | "2xl" | "3xl" | "4xl" | "full";

// Full static class strings so Tailwind can see them.
const LEVEL: Record<SurfaceLevel, string> = {
  1: "border-border",
  2: "border-border shadow-sm",
  3: "border-border shadow-md",
  4: "border-border shadow-lg",
};

// Hover/focus: brand-tinted border + a slightly deeper shadow. No movement.
const LIFT =
  "transition-[box-shadow,border-color] duration-200 motion-reduce:transition-none " +
  "hover:border-primary/30 hover:shadow-md " +
  "focus-visible:border-primary/30 focus-visible:shadow-md";

// Legacy "clay" variant: same flat recipe as above.
const CLAY_LEVEL: Record<SurfaceLevel, string> = {
  1: "border-border",
  2: "border-border shadow-sm",
  3: "border-border shadow-md",
  4: "border-border shadow-lg",
};

const CLAY_LIFT =
  "transition-[box-shadow,border-color] duration-200 motion-reduce:transition-none " +
  "hover:border-primary/30 hover:shadow-md " +
  "focus-visible:border-primary/30 focus-visible:shadow-md";

const RADIUS: Record<SurfaceRadius, string> = {
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
  "4xl": "rounded-4xl",
  full: "rounded-full",
};

type SurfaceOwnProps<T extends React.ElementType> = {
  as?: T;
  level?: SurfaceLevel;
  radius?: SurfaceRadius;
  /** Floating satellites only: bg-card/90. Never go below 85% opacity. */
  translucent?: boolean;
  /** Hover/focus lifts the surface to L3 with a soft glow. For L2 cards. */
  lift?: boolean;
  /** "layer" (default). "clay" is a legacy alias that renders identically. */
  variant?: "layer" | "clay";
  className?: string;
};

export type SurfaceProps<T extends React.ElementType = "div"> = SurfaceOwnProps<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof SurfaceOwnProps<T>>;

/**
 * Class string for a surface. Exported so client components that need their own
 * ref / handlers share the exact same elevation recipe.
 */
export function surfaceClass({
  level = 2,
  radius = "2xl",
  translucent = false,
  lift = false,
  variant = "layer",
  className,
}: Pick<
  SurfaceOwnProps<"div">,
  "level" | "radius" | "translucent" | "lift" | "variant" | "className"
> = {}) {
  if (variant === "clay") {
    return cn(
      "border bg-card text-card-foreground",
      CLAY_LEVEL[level],
      RADIUS[radius],
      lift && CLAY_LIFT,
      className,
    );
  }
  return cn(
    "border text-card-foreground",
    translucent ? "bg-card/90" : "bg-card",
    LEVEL[level],
    RADIUS[radius],
    lift && LIFT,
    className,
  );
}

export function Surface<T extends React.ElementType = "div">({
  as,
  level = 2,
  radius = "2xl",
  translucent = false,
  lift = false,
  variant = "layer",
  className,
  ...props
}: SurfaceProps<T>) {
  const Comp: React.ElementType = as ?? "div";

  return (
    <Comp
      className={surfaceClass({ level, radius, translucent, lift, variant, className })}
      {...props}
    />
  );
}
