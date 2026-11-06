import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "../../shared/components/primitives/button";
import type { ProductShowcaseBanner } from "../../types";

export interface BannerPanelProps {
  banner: ProductShowcaseBanner;
}

export function BannerPanel({ banner }: BannerPanelProps) {
  return (
    <div className="flex flex-col md:flex-row w-full rounded-2xl overflow-hidden mb-16 md:mb-24 shadow-xl">
      <div className="relative w-full md:w-1/2 aspect-[4/5] md:aspect-auto md:h-[500px]">
        <Image src={banner.image} alt="Collection Banner" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
      </div>
      <div className="w-full md:w-1/2 bg-[var(--showcase-banner-bg)] text-[var(--showcase-banner-text)] p-12 flex flex-col justify-center items-center text-center">
        <span className="font-sans text-[11px] uppercase tracking-[0.2em] mb-6 font-medium">
          {banner.label}
        </span>
        <h2
          className="font-heading text-[40px] md:text-[56px] leading-[1.05] uppercase mb-4"
          dangerouslySetInnerHTML={{ __html: banner.title }}
        />
        <p className="font-sans text-[18px] md:text-[20px] mb-10">{banner.subtitle}</p>

        <div className="flex items-center gap-4 md:gap-6">
          <Button asChild size="lg" className="rounded-xl px-7 uppercase text-[12px] md:text-[13px] font-bold tracking-[0.15em]">
            <Link href={banner.primaryBtnLink}>{banner.primaryBtnText}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
