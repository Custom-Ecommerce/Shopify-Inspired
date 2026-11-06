/* @markaz/storefront:phase2-flat-surface */
import * as React from "react";
import { cn } from "@/lib/utils";

export type SurfaceLevel = 0 | 1 | 2 | 3 | 4;
export type SurfaceVariant =
  | "default"
  | "muted"
  | "translucent"
  | "bordered"
  | "ghost"
  | "interactive";

export type SurfaceTag = "div" | "section" | "article" | "aside" | "li" | "a";

export interface SurfaceOwnProps {
  /**
   * Flat HCI elevation level (0 = flat, 4 = highest modal/popover elevation).
   * @default 1
   */
  level?: SurfaceLevel;
  /**
   * Visual treatment of the surface container.
   * @default "default"
   */
  variant?: SurfaceVariant;
  /**
   * Shorthand boolean for translucent surface styling.
   * @default false
   */
  translucent?: boolean;
  /**
   * Border radius token override.
   * @default "2xl"
   */
  radius?: "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full";
  /**
   * Internal padding preset.
   * @default "none"
   */
  padding?: "none" | "xs" | "sm" | "lg" | "md" | "xl";
  /**
   * Subtle border & shadow elevation bump on hover (no vertical translation).
   * @default false
   */
  lift?: boolean;
  /**
   * Render a subtle 1px inner highlight ring on the top edge.
   * @default false
   */
  specular?: boolean;
  /**
   * Render as a different HTML tag (div, section, article, aside, li, a).
   * @default "div"
   */
  as?: SurfaceTag;
}

export type SurfaceProps = SurfaceOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof SurfaceOwnProps> &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof SurfaceOwnProps>;

const LEVEL: Record<SurfaceLevel, string> = {
  0: "border-border shadow-none",
  1: "border-border shadow-sm",
  2: "border-border shadow-md",
  3: "border-border shadow-lg",
  4: "border-border shadow-xl",
};

const VARIANT: Record<SurfaceVariant, string> = {
  default: "bg-card text-card-foreground border",
  muted: "bg-muted/60 text-foreground border",
  translucent:
    "bg-card/85 text-card-foreground backdrop-blur-md border border-border/80",
  bordered: "bg-card text-card-foreground border border-border-strong",
  ghost: "bg-transparent text-foreground border-transparent shadow-none",
  interactive:
    "bg-card text-card-foreground border transition-[box-shadow,border-color,background-color] duration-(--dur-base) hover:border-border-strong hover:shadow-md",
};

const LIFT =
  "transition-[box-shadow,border-color,background-color] duration-(--dur-base) hover:shadow-md hover:border-border-strong";

const RADIUS: Record<NonNullable<SurfaceOwnProps["radius"]>, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
  full: "rounded-full",
};

const PADDING: Record<NonNullable<SurfaceOwnProps["padding"]>, string> = {
  none: "",
  xs: "p-3",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
  xl: "p-10",
};

export const Surface = React.forwardRef<HTMLElement, SurfaceProps>(
  (
    {
      as = "div",
      level = 1,
      variant = "default",
      translucent = false,
      radius = "2xl",
      padding = "none",
      lift = false,
      specular: _specular = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const effectiveVariant: SurfaceVariant = translucent
      ? "translucent"
      : variant in VARIANT
      ? variant
      : "default";

    const isGhost = effectiveVariant === "ghost";
    const Comp = as as React.ElementType;

    return (
      <Comp
        ref={ref}
        className={cn(
          "relative",
          VARIANT[effectiveVariant],
          !isGhost && LEVEL[level],
          RADIUS[radius],
          PADDING[padding],
          lift && LIFT,
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);

Surface.displayName = "Surface";
