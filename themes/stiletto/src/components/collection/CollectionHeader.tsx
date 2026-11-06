import React from "react";
import Image from "next/image";
import type { CollectionHeaderProps } from "../../types";

export function CollectionHeader({
  title,
  description,
  itemCount,
  category,
}: CollectionHeaderProps) {
  return (
    <div data-source="partial" data-source-note="Title and item count come from the store's data; wording around them is theme text." data-section="collection-header" className="w-full bg-[var(--collection-header-bg)] border-b border-[var(--separator-border)] pt-30 md:pt-40 pb-12 px-6 md:px-12">
      <div className="max-w-container-max mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-12 items-center gap-8 md:gap-0">
          
          {/* Left Text Content: 5 Columns */}
          <div className="md:col-span-6 flex flex-col items-center md:items-start text-center md:text-left">
            <span className="font-sans text-[12px] uppercase tracking-[0.2em] text-[var(--featured-card-muted)] mb-4 font-medium">
              {itemCount} {itemCount === 1 ? "Item" : "Items"} Available
            </span>
            <h1 className="font-heading text-[36px] md:text-[56px] uppercase text-[var(--featured-text)] leading-none mb-4">
              {title}
            </h1>
            {description && (
              <p className="font-sans text-[14px] md:text-[15px] text-[var(--featured-card-muted)] leading-relaxed max-w-xl">
                {description}
              </p>
            )}
          </div>

          {/* Spacer: 1 Column */}
          <div className="hidden md:block md:col-span-1" />

          {/* Right Image: 4 Columns */}
          {category?.image ? (
            <div className="md:col-span-5 w-full relative aspect-[4/3] rounded-2xl overflow-hidden border border-[var(--separator-border)] shadow-sm">
              <Image
                src={category.image}
                alt={title}
                fill
                sizes="(min-width: 768px) 35vw, 100vw"
                className="object-cover"
                priority
              />
            </div>
          ) : null}

        </div>
      </div>
    </div>
  );
}