"use client";

import React, { useState, useRef, MouseEvent } from "react";
import Image from "next/image";
import { ZoomIn, X } from "lucide-react";

interface ProductGalleryProps {
  images: { url: string; alt: string }[];
  title: string;
}

export function ProductGallery({ images, title }: ProductGalleryProps) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isZoomActive, setIsZoomActive] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });

  const containerRef = useRef<HTMLDivElement>(null);

  const displayImages =
    images && images.length > 0 ? images : [{ url: "/placeholder.jpg", alt: title }];

  const activeImage = displayImages[activeImageIndex] || displayImages[0]!;

  // Handle cursor move when Zoom is toggled ON
  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !isZoomActive) return;

    const { left, top, width, height } = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;

    setZoomPos({ x, y });
  };

  return (
    <div data-source="dynamic" data-source-note="Images come from the product." data-section="product-gallery" className="w-full flex flex-col gap-4">
      {/* Main Focus Image Container */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        className="relative aspect-[3/4] w-full overflow-hidden bg-[var(--featured-bg-secondary)] rounded-md select-none group"
      >
        {/* Main Base Image (Always visible by default) */}
        <Image
          src={activeImage.url}
          alt={activeImage.alt}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover object-center"
        />

        {/* Magnified Lens Layer (Only active when button clicked) */}
        {isZoomActive && (
          <div
            className="absolute inset-0 z-10 pointer-events-none cursor-crosshair transition-all duration-75"
            style={{
              backgroundImage: `url(${activeImage.url})`,
              backgroundPosition: `${zoomPos.x}% ${zoomPos.y}%`,
              backgroundSize: "250%",
              backgroundRepeat: "no-repeat",
            }}
          />
        )}

        {/* Bottom Right Corner Magnifier Toggle Button */}
        <button
          type="button"
          onClick={() => setIsZoomActive(!isZoomActive)}
          aria-label="Toggle Magnifier"
          className={`absolute bottom-3 right-3 z-20 w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-md ${
            isZoomActive
              ? "bg-[var(--featured-text)] text-[var(--text-inverse)] scale-105"
              : "bg-(--surface-elevated)/90 text-[var(--featured-text)] hover:bg-[var(--surface-elevated)] hover:scale-105"
          }`}
        >
          {isZoomActive ? (
            <X className="w-5 h-5" />
          ) : (
            <ZoomIn className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Thumbnails Gallery */}
      {displayImages.length > 1 && (
        <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none">
          {displayImages.map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setActiveImageIndex(idx);
                setIsZoomActive(false); // Reset zoom on image switch
              }}
              className={`relative h-20 w-16 min-w-[64px] flex-shrink-0 overflow-hidden rounded border transition-all ${
                activeImageIndex === idx
                  ? "border-[var(--featured-text)] opacity-100 ring-1 ring-[var(--featured-text)]"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <Image
                src={img.url}
                alt={img.alt}
                fill
                sizes="64px"
                className="object-cover object-center"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}