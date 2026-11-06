"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import type { NormalizedCategory } from "../../types";

interface CategoryGridSectionProps {
  categories: NormalizedCategory[];
  currentCategoryTitle?: string;
}

export function CategoryGridSection({
  categories,
  currentCategoryTitle,
}: CategoryGridSectionProps) {
  // Exclude current category if specified
  const otherCategories = categories.filter(
    (cat) => cat.title.toLowerCase() !== currentCategoryTitle?.toLowerCase()
  );

  if (otherCategories.length === 0) return null;

  return (
    <section className="pt-12 border-t border-[var(--separator-border)]">
      <h2 className="font-heading text-[22px] md:text-[30px] uppercase tracking-[0.08em] text-[var(--featured-text)] mb-6">
        Explore Other Categories
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {otherCategories.map((category) => (
          <Link
            key={category.id}
            href={category.href}
            className="group relative h-[260px] sm:h-[320px] rounded-lg overflow-hidden border border-[var(--separator-border)] block"
          >
            {category.image ? (
              <Image
                src={category.image}
                alt={category.title}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover object-center group-hover:scale-105 transition-transform duration-500"
              />
            ) : (
              <div className="w-full h-full bg-[var(--featured-bg-secondary)]" />
            )}

            {/* Dark Overlay */}
            <div className="absolute inset-0 bg-(--surface-inverse)/30 group-hover:bg-(--surface-inverse)/40 transition-colors" />

            {/* Title Content */}
            <div className="absolute inset-0 p-6 flex flex-col justify-end text-[var(--text-inverse)]">
              <h3 className="font-heading text-[20px] sm:text-[24px] uppercase tracking-[0.1em] font-semibold">
                {category.title}
              </h3>
              <p className="text-[12px] opacity-90 font-sans mt-1 line-clamp-2">
                {category.plainTextDescription}
              </p>
              <span className="inline-block mt-3 text-[11px] font-bold uppercase tracking-[0.15em] underline underline-offset-4">
                Shop Collection &rarr;
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}