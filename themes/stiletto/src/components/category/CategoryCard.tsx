import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { NormalizedCategory } from "../../types";

export function CategoryCard({ title, image, href }: NormalizedCategory) {
  return (
    <Link href={href} className="block w-full h-full group">
      <div className="relative rounded-2xl overflow-hidden flex flex-col h-full bg-[var(--surface-inverse)] shadow-sm">
        <div className="relative w-full aspect-[4/5] md:aspect-[3/4] bg-[var(--category-card-bg)] overflow-hidden">
          <Image
            src={image || "/placeholder.jpg"}
            alt={title}
            fill
            sizes="(min-width: 1024px) 21vw, (min-width: 768px) 28vw, 40vw"
            className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
          />
        </div>

        <div className="bg-[var(--surface-inverse)] text-[var(--text-inverse)] p-4 md:p-5 flex justify-between items-center mt-auto">
          <span className="font-sans text-[12px] md:text-[14px] font-semibold uppercase tracking-[0.1em]">
            {title}
          </span>
          <ArrowRight
            className="w-4 h-4 md:w-5 md:h-5 transform group-hover:translate-x-2 transition-transform duration-300 ease-out"
            strokeWidth={1.5}
          />
        </div>
      </div>
    </Link>
  );
}
