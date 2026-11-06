"use client";

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "../../shared/components/primitives/button";
import { videoMarqueeLoop } from "../../shared/lib/animations";
import type { VideoStoryProps } from "../../types";

export function VideoStory({ videoSrc, title, buttonText, buttonLink }: VideoStoryProps) {
  return (
    <section data-source="static" data-source-note="Video story is theme content." data-section="video-story" className="relative w-full h-[300px] overflow-hidden">
      <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" src={videoSrc} />
      <div className="absolute inset-0 bg-(--surface-inverse)/20" />

      <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6">
        <div className="w-full overflow-hidden whitespace-nowrap mb-6">
          <motion.div className="inline-block" animate={{ x: ["0%", "-50%"] }} transition={videoMarqueeLoop}>
            <h2 className="font-heading text-[40px] md:text-[50px] text-[var(--showcase-card-title)] uppercase tracking-tighter">
              {title} &nbsp;&nbsp;&nbsp; {title} &nbsp;&nbsp;&nbsp;
            </h2>
          </motion.div>
        </div>

        <Button
          asChild
          variant="secondary"
          size="lg"
          className="bg-[var(--video-story-btn-bg)] text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] rounded-md px-8 py-5 text-[12px] font-bold tracking-[0.1em] uppercase"
        >
          <Link href={buttonLink}>{buttonText}</Link>
        </Button>
      </div>
    </section>
  );
}
