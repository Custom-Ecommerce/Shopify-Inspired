"use client";

import React from "react";
import { motion } from "framer-motion";
import { marqueeLoop } from "../../shared/lib/animations";
import type { MarqueeProps } from "../../types";

export function Marquee({ messages }: MarqueeProps) {
  // Duplicated 4x so the loop is seamless with no visible gap.
  const loopItems = [...messages, ...messages, ...messages, ...messages];

  return (
    <div data-source="static" data-source-note="Scrolling text is theme content." data-section="marquee" className="bg-[var(--surface-inverse)] py-4 overflow-hidden flex whitespace-nowrap w-full">
      <motion.div
        className="flex items-center w-max"
        animate={{ x: ["0%", "-50%"] }}
        transition={marqueeLoop}
      >
        {loopItems.map((msg, idx) => (
          <div key={idx} className="flex items-center">
            <span className="text-[var(--nav-transparent-text)] font-sans text-[13px] md:text-[14px] font-semibold uppercase tracking-[0.15em] px-8 md:px-12">
              {msg}
            </span>
            <span className="text-[var(--nav-transparent-text)] text-[12px] opacity-80">♦</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
