"use client";

import type { HeroProps } from "../../types";
import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "../../shared/components/primitives/button";
import { heroContentTransition } from "../../shared/lib/animations";

export function Hero({
  videoSrc,
  posterImage,
  title,
  subHeading,
  buttonText,
  buttonLink,
  secondaryButtonText,
  secondaryButtonLink,
}: HeroProps) {
  return (
    <section data-source="static" data-source-note="Hero headline, imagery and buttons are theme content; sellers cannot edit them yet." data-section="hero" className="relative w-full h-screen min-h-[700px] flex items-center overflow-hidden">
      {/* Background Video */}
      <div className="absolute inset-0 z-0 bg-[var(--hero-video-bg)]">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={posterImage}
          className="w-full h-full object-cover opacity-90"
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-(--surface-inverse)/20" />
      </div>

      <div className="relative z-10 px-6 md:px-16 pt-[120px] pb-8 md:pb-12 max-w-container-max mx-auto w-full h-full flex flex-col md:flex-row">
        {/* Hero Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={heroContentTransition}
          viewport={{ once: true }}
          className="flex-1 flex flex-col justify-center items-center text-center md:items-start md:text-left w-full h-full"
        >
          <h1
            className="font-heading text-[48px] md:text-[80px] leading-[1.05] tracking-[-0.01em] text-[var(--text-inverse)] mb-4 uppercase"
            dangerouslySetInnerHTML={{ __html: title }}
          />

          <p className="font-sans text-[16px] md:text-[18px] text-(--text-inverse)/90 mb-8 font-normal tracking-wide">
            {subHeading}
          </p>

          <div className="flex flex-row md:flex-wrap justify-center md:justify-start gap-3 md:gap-4">
            <Button
              asChild
              className="relative overflow-hidden group bg-[var(--surface-elevated)] text-[var(--text-primary)] border-none rounded-lg md:rounded-xl px-5 py-5 md:px-8 md:py-7 text-[11px] md:text-[13px] uppercase tracking-[0.08em] md:tracking-[0.1em] font-bold w-fit hover:bg-[var(--surface-elevated)]"
            >
              <Link href={buttonLink}>
                <span className="absolute inset-0 w-[150%] left-[-25%] bg-[var(--hero-cta-sweep)] translate-x-[-100%] -skew-x-12 group-hover:translate-x-0 transition-transform duration-500 ease-out z-0" />
                <span className="relative z-10 group-hover:text-[var(--text-primary)] transition-colors duration-300">
                  {buttonText}
                </span>
              </Link>
            </Button>

            {secondaryButtonText && secondaryButtonLink && (
              <Button
                asChild
                variant="outline"
                className="bg-transparent text-[var(--text-inverse)] border-[var(--text-inverse)] border hover:bg-(--surface-elevated)/10 hover:text-[var(--text-inverse)] rounded-lg md:rounded-xl px-5 py-5 md:px-8 md:py-7 text-[11px] md:text-[13px] uppercase tracking-[0.08em] md:tracking-[0.1em] font-bold transition-all duration-300 w-fit"
              >
                <Link href={secondaryButtonLink}>{secondaryButtonText}</Link>
              </Button>
            )}
          </div>
        </motion.div>

      </div>
    </section>
  );
}
