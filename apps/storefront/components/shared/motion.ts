import type { CSSProperties } from "react";

/*
 * Motion helpers. This file has no "use client", so server components can call it.
 * The CSS they feed lives in app/globals.css, section 5 (MOTION).
 */

/** Stagger for sibling Reveal blocks. At most three steps, so a long list never waits on its last item. */
export function staggerDelay(index: number, step = 100): number {
  return Math.min(index, 2) * step;
}

/** Inline delay for the CSS rise/fade classes (.motion-rise, .motion-fade). Ignored with reduced motion. */
export function riseDelay(ms: number): CSSProperties {
  return { ["--rise-delay" as string]: `${ms}ms` } as unknown as CSSProperties;
}
