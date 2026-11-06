"use client";

import { motion } from "framer-motion";
import { Eye } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { productCardDictionary } from "../../constants/dictionary";
import { productCardExitVariants } from "../../lib/animations";
import { Button } from "../primitives/button";

import "swiper/css";
import "swiper/css/pagination";
import { Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";

import type { NormalizedProduct } from "../../../types";
import { paths } from "../../../adapters/paths";

export type ProductCardVariant = "showcase" | "featured";

const variantClasses = {
  showcase: {
    imageBg: "bg-[var(--showcase-card-bg)]",
    title: "text-[var(--showcase-card-title)]",
    muted: "text-[var(--showcase-card-muted)]",
    swatch: "border-[var(--showcase-swatch-border)]",
    sizeBox:
      "border-[var(--showcase-card-muted)] text-[var(--showcase-card-muted)] hover:text-[var(--showcase-card-title)] hover:border-[var(--showcase-card-title)]",
    overlayButton:
      "bg-[var(--showcase-overlay-btn)] text-[var(--showcase-card-title)] hover:bg-[var(--showcase-overlay-btn)] hover:text-[var(--showcase-card-title)]",
  },
  featured: {
    imageBg: "bg-[var(--featured-card-bg)]",
    title: "text-[var(--featured-text)]",
    muted: "text-[var(--featured-card-muted)]",
    swatch: "border-[var(--featured-swatch-border)]",
    sizeBox:
      "border-[var(--featured-card-muted)] text-[var(--featured-card-muted)] hover:text-[var(--featured-text)] hover:border-[var(--featured-text)]",
    overlayButton: "",
  },
} as const;

export interface ProductCardProps {
  product: NormalizedProduct;
  index: number;
  variant: ProductCardVariant;
}

/**
 * SSR-safe, deterministic color check.
 * Guarantees identical output on both server and client to prevent hydration mismatch.
 */
function isRenderableCssColor(value: string): boolean {
  if (!value) return false;
  const val = value.trim().toLowerCase();

  // 1. Hex, RGB, HSL check
  if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(val)) return true;

  // 2. Standard CSS Color Keywords
  const standardCssColors = new Set([
    "black", "white", "red", "green", "blue", "yellow", "orange", "purple", 
    "pink", "brown", "grey", "gray", "beige", "maroon", "navy", "teal", 
    "cyan", "magenta", "lime", "olive", "coral", "turquoise", "violet", 
    "indigo", "gold", "silver", "ivory", "khaki", "plum", "lavender", "nude"
  ]);

  return standardCssColors.has(val);
}

export function ProductCard({ product, index, variant }: ProductCardProps) {
  const tokens = variantClasses[variant];
  const isShowcase = variant === "showcase";

  const { images, colors, sizes, price, variantsInfo, title, handle, link } = product;

  const productLink = link || paths.product(handle);

  return (
    <motion.div
      variants={productCardExitVariants}
      initial="hidden"
      whileInView={isShowcase ? "visible" : undefined}
      animate={!isShowcase ? "visible" : undefined}
      exit={!isShowcase ? "exit" : undefined}
      viewport={isShowcase ? { once: true } : undefined}
      transition={{ duration: 0.3, delay: index * (isShowcase ? 0.1 : 0.05) }}
      className="snap-start shrink-0 w-[60vw] md:w-[28vw] lg:w-[22%] max-w-[320px] flex flex-col group cursor-pointer"
    >
      <div className={`relative w-full aspect-[3/4] ${tokens.imageBg} rounded-xl overflow-hidden mb-5`}>
        <Swiper
          modules={[Pagination]}
          pagination={{ clickable: true }}
          className="w-full h-full product-card-swiper"
        >
          {images.map((url, i) => (
            <SwiperSlide key={i} className="w-full h-full relative">
              <Image
                src={url}
                alt={`${title} - Image ${i + 1}`}
                fill
                sizes="(min-width: 1024px) 22vw, (min-width: 768px) 28vw, 60vw"
                className={`object-cover transition-opacity duration-700 ease-out ${
                  i === 0 && images[1] ? "group-hover:opacity-0" : ""
                }`}
              />

              {i === 0 && images[1] && (
                <Image
                  src={images[1]}
                  alt={`${title} alternate`}
                  fill
                  sizes="(min-width: 1024px) 22vw, (min-width: 768px) 28vw, 60vw"
                  className="object-cover opacity-0 group-hover:opacity-100 transition-all duration-700 ease-out"
                />
              )}
            </SwiperSlide>
          ))}
        </Swiper>

        <Link
          href={productLink}
          aria-label={`View details for ${title}`}
          className="md:hidden absolute bottom-3 z-10 right-3 w-10 h-10 rounded-full border border-(--text-inverse)/40 bg-(--surface-inverse)/30 backdrop-blur-md flex items-center justify-center text-[var(--text-inverse)] active:scale-95 transition-transform"
        >
          <Eye className="w-5 h-5" strokeWidth={1.5} />
        </Link>

        <div className="hidden md:flex absolute z-10 bottom-4 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 justify-center">
          <Link href={productLink}>
            <Button
              size="lg"
              variant={isShowcase ? "default" : "outline"}
              className={`rounded-md uppercase tracking-[0.1em] border-0 shadow-lg ${tokens.overlayButton}`}
            >
              {productCardDictionary.chooseOptions || "View Details"}
            </Button>
          </Link>
        </div>
      </div>

      <div className="text-center flex flex-col items-center">
        <Link href={productLink} className="hover:underline">
          <h3 className={`font-sans text-[16px] md:text-[18px] ${tokens.title} font-normal mb-1 text-primary`}>
            {title}
          </h3>
        </Link>
        <p className={`font-sans text-[15px] md:text-[16px] ${tokens.title} mb-1 text-primary`}>
          {price}
        </p>
        <p className={`font-sans text-[12px] md:text-[13px] ${tokens.muted} mb-4 text-primary`}>
          {variantsInfo}
        </p>

        <div className="hidden md:flex flex-col items-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 gap-2.5 w-full px-2">
          {colors && colors.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center max-w-[220px] mx-auto">
              {colors.map((color, i) => {
                const colorValue = color.toLowerCase().trim();
                const renderableAsSwatch = isRenderableCssColor(colorValue);

                return renderableAsSwatch ? (
                  <div
                    key={`${color}-${i}`}
                    className={`shrink-0 w-[20px] h-[20px] rounded-[6px] border ${tokens.swatch}`}
                    style={{ backgroundColor: colorValue }}
                    title={color}
                  />
                ) : (
                  <div
                    key={`${color}-${i}`}
                    className={`shrink-0 flex items-center justify-center h-[20px] px-2 rounded-[6px] border text-[9px] leading-none whitespace-nowrap ${tokens.swatch} ${tokens.muted}`}
                    title={color}
                  >
                    {color}
                  </div>
                );
              })}
            </div>
          )}

          {sizes && sizes.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center max-w-[220px] mx-auto text-primary">
              {sizes.map((size, i) => (
                <div
                  key={`${size}-${i}`}
                  className={`shrink-0 border text-[10px] min-w-7 h-7 px-1 flex items-center justify-center rounded-[4px] transition-colors ${tokens.sizeBox} text-primary`}
                >
                  {size}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}