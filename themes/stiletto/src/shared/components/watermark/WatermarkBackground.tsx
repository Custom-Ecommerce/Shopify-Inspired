"use client";

import Image from "next/image";
import { useState } from "react";

export interface WatermarkBackgroundProps {
  logoUrl?: string;
  opacity?: string;
  size?: number;
  className?: string;
}

export function WatermarkBackground({
  logoUrl,
  opacity = "opacity-[0.12]",
  size = 520,
  className = "",
}: WatermarkBackgroundProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!logoUrl || imageFailed) return null;

  return (
    <div
      data-source="partial" data-source-note="The store's logo when it has one; otherwise the theme logo." data-section="watermark" aria-hidden="true"
      className={`pointer-events-none fixed inset-0 flex items-center justify-center z-1000 overflow-hidden select-none ${opacity} ${className}`}
    >
      <div
        className="relative"
        style={{ width: size, height: size }}
      >
        <Image
          src={logoUrl}
          alt=""
          fill
          sizes={`${size}px`}
          className="object-contain"
          priority={false}
          unoptimized
          onError={() => setImageFailed(true)}
        />
      </div>
    </div>
  );
}