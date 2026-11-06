import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * FloatLayer: gentle transform-only float (translateY only).
 *
 * - The `floatY` keyframes live in globals.css; the speed classes reference them directly.
 * - Travel distance is passed to the shared `floatY` keyframes via --float-y.
 * - Use a NEGATIVE `delay` (seconds) so siblings never move in sync.
 * - Disabled under prefers-reduced-motion.
 * - Keep translateZ / positioning on a PARENT element: the animation owns
 *   this element's `transform`, so anything set here would be overridden.
 *
 * Dashboard rule (blueprint §2.3): motion on first paint and on interaction
 * only. Ambient loops belong to auth screens, not data pages.
 */
export type FloatSpeed = "slow" | "mid" | "fast";

const SPEED: Record<FloatSpeed, string> = {
  slow: "animate-[floatY_7s_ease-in-out_infinite] [--float-y:-8px]",
  mid: "animate-[floatY_5.5s_ease-in-out_infinite] [--float-y:-6px]",
  fast: "animate-[floatY_4.5s_ease-in-out_infinite] [--float-y:-5px]",
};

interface FloatLayerProps extends React.HTMLAttributes<HTMLDivElement> {
  speed?: FloatSpeed;
  /** Animation delay in seconds. Use negative values, e.g. -1.2. */
  delay?: number;
}

export function FloatLayer({
  speed = "mid",
  delay = 0,
  className,
  style,
  children,
  ...props
}: FloatLayerProps) {
  return (
    <div
      className={cn("will-change-transform motion-reduce:animate-none", SPEED[speed], className)}
      style={{ animationDelay: delay ? `${delay}s` : undefined, ...style }}
      {...props}
    >
      {children}
    </div>
  );
}
