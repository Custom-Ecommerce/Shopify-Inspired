import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * A pulsing placeholder block. Reduced-motion users get a still block. Screen readers skip the block itself,
 * because the surrounding status region announces the loading state.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn("animate-pulse bg-(--mu-skeleton) motion-reduce:animate-none", className)}
    />
  );
}
