"use client";

import { BrandDisplayProps } from "../../types";
import Image from "next/image";
import Link from "next/link";
import { paths } from "../../adapters/paths";
import { useState } from "react";

export function BrandDisplay({ brand, className }: BrandDisplayProps) {
  const [imageFailed, setImageFailed] = useState(false);

  const showImage = Boolean(brand.logo) && !imageFailed;

  return (
    <Link
      href={brand.href || paths.home}
      className={`flex items-center justify-start transition-opacity hover:opacity-80 ${className || ""}`}
    >
      {showImage ? (
        <Image
          src={brand.logo as string}
          alt={brand.name}
          width={200}
          height={64}
          className="h-full w-auto object-contain object-left"
          unoptimized
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="font-serif text-[28px] md:text-[32px] tracking-tight uppercase text-left">
          {brand.name}
        </span>
      )}
    </Link>
  );
}