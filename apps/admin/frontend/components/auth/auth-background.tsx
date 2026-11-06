import type { CSSProperties } from "react";

/**
 * AuthBackground: purely decorative, server-rendered, zero JS.
 * Grid + a few pulsing cells + ambient glow + light sweep. Colours come only from the
 * --border and --primary tokens. Animations use the motion-safe: prefix, so
 * prefers-reduced-motion disables them without any script.
 */
const AUTH_CELLS = [
  { col: 3, row: 2, duration: "4.1s", delay: "0s" },
  { col: 9, row: 5, duration: "5.7s", delay: "-1.4s" },
  { col: 15, row: 1, duration: "3.8s", delay: "-0.7s" },
  { col: 6, row: 8, duration: "6.2s", delay: "-2.1s" },
  { col: 20, row: 4, duration: "4.9s", delay: "-0.3s" },
  { col: 12, row: 7, duration: "5.3s", delay: "-1.8s" },
] as const;

export function AuthBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex justify-center overflow-hidden [--grid:48px] sm:[--grid:64px]">
      <div
        className="absolute inset-0 z-0 bg-background"
        style={{
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 30%, black 20%, transparent 80%)",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 30%, black 20%, transparent 80%)",
        }}
      >
        <div className="absolute inset-x-0 mx-auto h-full" style={{ width: "calc(var(--grid) * 24)" }}>
          {/* Grid lines */}
          <div
            className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--border)_60%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_60%,transparent)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,color-mix(in_oklab,var(--border)_14%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_14%,transparent)_1px,transparent_1px)]"
            style={{ backgroundSize: "var(--grid) var(--grid)" }}
          />

          {/* Pulsing cells */}
          {AUTH_CELLS.map((cell, i) => (
            <div
              key={i}
              className="absolute opacity-0 motion-safe:animate-[cellFade_var(--duration)_infinite]"
              style={
                {
                  width: "var(--grid)",
                  height: "var(--grid)",
                  left: "calc(var(--grid) * " + cell.col + ")",
                  top: "calc(var(--grid) * " + cell.row + ")",
                  backgroundColor: "color-mix(in oklab, var(--primary) 8%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--primary) 35%, transparent)",
                  "--duration": cell.duration,
                  animationDelay: cell.delay,
                } as CSSProperties
              }
            />
          ))}

          {/* Ambient glow */}
          <div
            className="absolute left-1/2 top-[20%] h-64 w-[600px] max-w-full -translate-x-1/2 rounded-[100%] bg-primary/15 blur-[100px] dark:bg-primary/25 motion-safe:animate-[glowBreathe_6s_infinite]"
            style={{ opacity: 0.45 }}
          />

          {/* Light sweep */}
          <div
            className="absolute left-0 right-0 h-px w-full motion-safe:animate-[lightBeam_14s_linear_infinite]"
            style={{
              top: "calc(var(--grid) * 2)",
              background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
              transform: "translateX(-100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
