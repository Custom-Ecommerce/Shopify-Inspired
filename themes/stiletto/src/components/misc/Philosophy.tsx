"use client";

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "../../shared/components/primitives/button";
import { fadeInUpSmall, fadeInUp } from "../../shared/lib/animations";
import type { PhilosophyProps } from "../../types";

export function Philosophy({ heading, title, buttonText, buttonLink }: PhilosophyProps) {
  return (
    <section data-source="static" data-source-note="Brand story text is theme content." data-section="philosophy" className="w-full bg-[var(--philosophy-bg)] border-t border-[var(--philosophy-border)]">
      <div className="w-full px-6 md:px-16 py-16 md:py-20">
        <div className="w-full flex flex-col items-start text-left">
          <motion.p
            variants={fadeInUpSmall}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="mb-8 text-[16px] md:text-[20px] font-normal leading-none text-[var(--text-primary)]"
          >
            {heading}
          </motion.p>

          <motion.h2
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="w-full uppercase text-[var(--text-primary)] font-normal tracking-tight leading-tight text-[30px] md:text-[40px] mb-12"
            dangerouslySetInnerHTML={{ __html: title }}
          />

          <motion.div
            variants={fadeInUpSmall}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <Button
              asChild
              className="relative overflow-hidden group bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--surface-inverse)] rounded-lg md:rounded-xl px-5 py-5 md:px-8 md:py-7 text-[11px] md:text-[13px] uppercase tracking-[0.08em] md:tracking-[0.1em] font-bold w-fit hover:bg-[var(--surface-elevated)]"
            >
              <Link href={buttonLink}>
                <span className="absolute inset-0 w-[150%] left-[-25%] bg-[var(--hero-cta-sweep)] translate-x-[-100%] -skew-x-12 group-hover:translate-x-0 transition-transform duration-500 ease-out z-0" />
                <span className="relative z-10 group-hover:text-[var(--text-primary)] transition-colors duration-300">
                  {buttonText}
                </span>
              </Link>
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
