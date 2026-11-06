import * as React from "react";
import { Surface, type SurfaceProps } from "./surface";
import { cn } from "@/lib/utils";

export type CardVariant = "default" | "interactive";
export type CardPadding = "none" | "sm" | "md" | "lg" | "responsive";

export type CardProps = Omit<
  SurfaceProps,
  "variant" | "level" | "radius" | "padding" | "lift" | "specular"
> & {
  variant?: CardVariant;
  padding?: CardPadding;
};

const CARD_PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
  responsive: "p-6 md:p-8",
};

const CARD_INTERACTIVE =
  "transition-[transform,box-shadow,border-color] duration-(--dur-base) ease-out-expo hover:border-border-strong hover:shadow-md motion-safe:hover:-translate-y-0.5";

export const Card = React.forwardRef<HTMLElement, CardProps>(
  (
    {
      as = "div",
      variant = "default",
      padding = "responsive",
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <Surface
        ref={ref}
        as={as}
        level={1}
        variant="default"
        radius="2xl"
        padding="none"
        className={cn(
          CARD_PADDING[padding],
          variant === "interactive" && CARD_INTERACTIVE,
          className
        )}
        {...props}
      >
        {children}
      </Surface>
    );
  }
);

Card.displayName = "Card";
