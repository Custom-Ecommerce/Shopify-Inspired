"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAutoRotate } from "../../shared/hooks/useAutoRotate";
import { testimonialSlideVariants } from "../../shared/lib/animations";
import type { TestimonialsProps } from "../../types";

export function Testimonials({ heading, quotes }: TestimonialsProps) {
  const { index, next, prev } = useAutoRotate(quotes.length, 5000);
  const activeQuote = quotes[index];

  if (!activeQuote) return null;

  return (
    <section data-source="static" data-source-note="Testimonials are theme content; the platform has none yet." data-section="testimonials" className="bg-[var(--testimonials-bg)] py-20 px-6">
      <div className="max-w-container-max mx-auto relative flex flex-col items-center">
        <p className="font-serif text-[25px] lowercase font-bold tracking-widest mb-6">{heading}</p>

        <div className="w-full relative flex items-center justify-center">
          <button onClick={prev} className="absolute left-0 md:left-8 p-2 hover:opacity-50 z-10 transition-opacity">
            <ChevronLeft size={32} />
          </button>

          <div className="text-center px-16 md:px-32">
            <AnimatePresence mode="wait">
              <motion.h2
                key={activeQuote.id}
                variants={testimonialSlideVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ duration: 0.5 }}
                className="font-heading text-[28px] md:text-[40px] leading-tight uppercase"
              >
                {activeQuote.text}
              </motion.h2>
            </AnimatePresence>
          </div>

          <button onClick={next} className="absolute right-0 md:right-8 p-2 hover:opacity-50 z-10 transition-opacity">
            <ChevronRight size={32} />
          </button>
        </div>

        <div className="flex justify-center gap-2 mt-8">
          {quotes.map((quote, i) => (
            <div
              key={quote.id}
              className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                i === index ? "bg-[var(--surface-inverse)] scale-125" : "bg-[var(--testimonials-dot)]"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
