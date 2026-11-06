"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Layout effects run before the first paint on the client, so a hidden block never flashes
// visible. On the server they would warn, so fall back to useEffect there (SSR renders visible).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type RevealProps = React.HTMLAttributes<HTMLDivElement> & {
  /** delay in ms, for staggering siblings (see staggerDelay in motion.ts) */
  delay?: number;
};

/**
 * Fades a block in and moves it 12px up once it scrolls into view. Runs once per block.
 * Content is visible without JS and with reduced motion: the hidden state is only set when
 * motion is allowed and the block starts below the fold.
 */
export function Reveal({ className, delay = 0, style, children, ...props }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"visible" | "hidden" | "revealed">("visible");

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already on screen

    setState("hidden");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState("revealed");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-revealed={state === "revealed" ? "" : undefined}
      style={{ transitionDelay: delay ? `${delay}ms` : undefined, ...style }}
      className={cn(
        "transition-[opacity,transform] duration-500 ease-out-expo",
        state === "hidden" && "translate-y-3 opacity-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
