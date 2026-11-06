"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAutoRotate } from "../../shared/hooks/useAutoRotate";
import { announcementSwap } from "../../shared/lib/animations";
import type { AnnouncementData } from "../../types";

export interface AnnouncementBarProps {
  announcement: AnnouncementData;
}

export function AnnouncementBar({ announcement }: AnnouncementBarProps) {
  const { messages, showArrows } = announcement;
  const { index, next, prev } = useAutoRotate(messages.length, 5000);

  if (!messages || messages.length === 0) return null;

  return (
    <div data-source="partial" data-source-note="Message comes from the store's announcement text when set; otherwise theme text." data-section="announcement-bar" className="bg-[var(--surface-inverse)] py-2 px-margin-mobile md:px-margin-desktop flex justify-center items-center relative overflow-hidden">
      <div className="flex items-center justify-center gap-4 text-[var(--nav-transparent-text)] w-full max-w-[400px]">
        {showArrows && messages.length > 1 && (
          <ChevronLeft
            onClick={prev}
            className="w-[14px] h-[14px] md:w-4 md:h-4 cursor-pointer hover:opacity-70 transition-opacity shrink-0"
          />
        )}

        <div className="text-[10px] md:text-[11px] uppercase tracking-widest font-sans font-medium text-center flex-1 overflow-hidden h-[16px] flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.span
              key={index}
              variants={announcementSwap}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="block w-full text-center"
            >
              {messages[index]}
            </motion.span>
          </AnimatePresence>
        </div>

        {showArrows && messages.length > 1 && (
          <ChevronRight
            onClick={next}
            className="w-[14px] h-[14px] md:w-4 md:h-4 cursor-pointer hover:opacity-70 transition-opacity shrink-0"
          />
        )}
      </div>
    </div>
  );
}
