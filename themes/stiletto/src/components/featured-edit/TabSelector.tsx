"use client";

import React from "react";
import type { FeaturedEditTab } from "../../types";

export interface TabSelectorProps {
  tabs: FeaturedEditTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function TabSelector({ tabs, activeIndex, onSelect }: TabSelectorProps) {
  return (
    <div className="flex gap-6 overflow-x-auto no-scrollbar border-b border-[var(--featured-tabs-border)]">
      {tabs.map((tab, index) => (
        <button
          key={tab.label}
          onClick={() => onSelect(index)}
          className={`pb-3 font-sans text-[13px] md:text-[15px] uppercase tracking-[0.05em] transition-all whitespace-nowrap border-b-[2px] cursor-pointer ${
            activeIndex === index
              ? "text-[var(--featured-text)] border-[var(--featured-text)] font-semibold"
              : "text-[var(--featured-card-muted)] border-transparent hover:text-[var(--featured-text)]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
