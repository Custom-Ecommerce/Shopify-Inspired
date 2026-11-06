"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type RevealProps = React.HTMLAttributes<HTMLDivElement> & {
  /** delay in ms, for staggering siblings */
  delay?: number;
};

/**
 * Reveal: IntersectionObserver-based scroll reveal.
 *
 * Blueprint §4.6: use on the first section only. Don't stagger every card
 * on a data dashboard — page-load reveal only.
 *
 * Disabled automatically under prefers-reduced-motion.
 */
export function Reveal({ className, delay = 0, style, children, ...props }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"visible" | "hidden" | "revealed">("visible");

  useEffect(() => {
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
        "transition-[opacity,transform] duration-700 ease-out-expo",
        state === "hidden" && "translate-y-6 opacity-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
