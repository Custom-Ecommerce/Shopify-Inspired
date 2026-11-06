"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { Button } from "../../shared/components/primitives/button";
import { megaMenuVariants } from "../../shared/lib/animations";
import type { NormalizedCategory } from "../../types";

export interface MegaMenuProps {
  isOpen: boolean;
  category?: NormalizedCategory | null; // NAYA: Ab poori category object aayegi
}

export function MegaMenu({ isOpen, category }: MegaMenuProps) {
  return (
    <AnimatePresence>
      {isOpen && category && (
        <motion.div
          variants={megaMenuVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-full left-0 w-full bg-[var(--nav-solid-bg)] text-[var(--nav-solid-text)] border-b border-[var(--nav-solid-border)] overflow-hidden origin-top z-40 hidden md:block"
        >
          <div className="max-w-container-max mx-auto py-12 px-margin-desktop">
            <div className="grid grid-cols-12 gap-12 items-center">
              
              {/* Left Side (4 Cols): Title & Description */}
              <div className="col-span-12 md:col-span-4 flex flex-col justify-center gap-6 pr-8">
                <h2 className="font-heading text-3xl md:text-4xl uppercase tracking-widest text-[var(--nav-solid-text)] leading-tight">
                  {category.title}
                </h2>
                
                {category.plainTextDescription && (
                  <p className="font-sans text-[14px] leading-relaxed text-[var(--nav-mega-sub-text)] line-clamp-4">
                    {category.plainTextDescription}
                  </p>
                )}
                
                <Button 
                  asChild 
                  variant="default" 
                  className="w-fit mt-2 rounded-md uppercase tracking-[0.15em] text-xs px-8 py-5"
                >
                  <Link href={category.href}>View Collection</Link>
                </Button>
              </div>

              {/* Right Side (8 Cols): Large Image Promo */}
              <div className="col-span-12 md:col-span-8 relative group cursor-pointer overflow-hidden aspect-[21/9] md:aspect-[16/7] rounded-2xl">
                <Image
                  alt={category.title}
                  fill
                  sizes="(min-width: 768px) 66vw, 100vw"
                  className="object-cover grayscale-[15%] group-hover:scale-105 transition-transform duration-1000"
                  src={category.image}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-(--surface-inverse)/80 via-(--surface-inverse)/20 to-transparent" />
                
                <div className="absolute bottom-10 left-10 flex flex-col gap-5">
                  <h3 className="font-heading text-2xl md:text-3xl text-[var(--text-inverse)] font-normal uppercase tracking-widest">
                    {category.title}
                  </h3>
                  <Button
                    asChild
                    variant="outline"
                    className="w-fit px-8 py-5 rounded-full border-(--text-inverse)/50 text-[var(--text-inverse)] bg-transparent font-sans text-[11px] font-semibold uppercase tracking-[0.15em] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] transition-all hover:border-[var(--text-inverse)]"
                  >
                    <Link href={category.href}>Shop Now</Link>
                  </Button>
                </div>
              </div>
              
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
