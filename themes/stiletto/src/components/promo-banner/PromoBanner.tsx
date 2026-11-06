"use client";

import React from "react";
import Link from "next/link";
import { Button } from "../../shared/components/primitives/button";
import { CountdownTimer } from "./CountdownTimer";
import { useCountdown } from "../../shared/hooks/useCountdown";
import type { PromoBannerProps } from "../../types";

export function PromoBanner({ heading, targetDate, subHeading, buttonText, buttonLink }: PromoBannerProps) {
  const timeLeft = useCountdown(targetDate);

  return (
    <section data-source="static" data-source-note="Promo banner and countdown are theme content." data-section="promo-banner" className="w-full px-5 md:px-16 py-8 md:py-16">
      <div className="max-w-container-max mx-auto bg-[var(--promo-banner-bg)] text-[var(--promo-banner-text)] rounded-xl py-12 px-6 md:px-12 flex flex-col xl:flex-row items-center justify-between gap-10 xl:gap-8">
        <h2 className="font-sans text-[20px] md:text-[24px] uppercase tracking-[0.05em] font-medium text-center xl:text-left xl:w-[25%]">
          {heading}
        </h2>

        <CountdownTimer time={timeLeft} />

        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 text-center xl:text-right xl:w-[35%] justify-end">
          <p className="font-sans text-[18px] md:text-[20px]">{subHeading}</p>
          <Button
            asChild
            className="bg-[var(--promo-banner-button-bg)] text-[var(--promo-banner-button-text)] hover:opacity-90 rounded-md px-8 py-7 font-sans text-[13px] uppercase tracking-[0.1em] font-bold border-none transition-opacity shrink-0"
          >
            <Link href={buttonLink}>{buttonText}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
