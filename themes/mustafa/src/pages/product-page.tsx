"use client";

import * as React from "react";
import Link from "next/link";
import type { ProductPageProps } from "@markaz/storefront-theme-kit";
import { Button, buttonVariants } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { AddToCart } from "../components/add-to-cart";
import { ProductCard } from "../components/product-card";
import { StatusPanel } from "../components/status-panel";
import { IconShoppingBag } from "../components/ui/icons";

function formatCurrency(amount: number, currency = "PKR"): string {
  try {
    return new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

const NUTRI_LETTERS = [
  { grade: "A", bg: "bg-[var(--mu-color-nutri-a)] text-white" },
  { grade: "B", bg: "bg-[var(--mu-color-nutri-b)] text-white" },
  {
    grade: "C",
    bg: "bg-[var(--mu-color-nutri-c)] text-[var(--mu-color-ink)]",
  },
  { grade: "D", bg: "bg-[var(--mu-color-nutri-d)] text-white" },
  { grade: "E", bg: "bg-[var(--mu-color-nutri-e)] text-white" },
];

export function ProductPage(props: ProductPageProps) {
  const store = (props as any).store;
  const product = (props as any).product;
  const storePaths = (props as any).storePaths ?? (props as any).paths ?? {};
  const relatedProducts: any[] = (props as any).relatedProducts ?? [];

  const [selectedImageIdx, setSelectedImageIdx] = React.useState(0);
  const [selectedVariant, setSelectedVariant] = React.useState(0);
  const [openAccordion, setOpenAccordion] = React.useState<string | null>(
    "allergens"
  );

  const homeHref: string = storePaths.home ?? "/";
  const catalogHref: string =
    storePaths.catalog ?? storePaths.products ?? "/products";
  const checkoutHref: string =
    storePaths.checkout ?? storePaths.cart ?? "/cart";

  if (!product) {
    return (
      <StatusPanel
        title="Product not found"
        description="The item you are looking for is no longer available in our catalog."
        action={
          <Link href={catalogHref} className={buttonVariants({ size: "md" })}>
            Browse Catalog
          </Link>
        }
      />
    );
  }

  const p = product as Record<string, any>;
  const rawImages = Array.isArray(p.images) ? p.images : [];
  const normalizedImages: Array<{ url: string; alt?: string }> =
    rawImages.length > 0
      ? rawImages.map((img: any) =>
          typeof img === "string"
            ? { url: img, alt: p.title }
            : { url: img.url ?? img.src ?? "", alt: img.alt ?? p.title }
        )
      : p.imageUrl || p.image || p.thumbnailUrl
        ? [
            {
              url: p.imageUrl ?? p.image ?? p.thumbnailUrl,
              alt: p.title,
            },
          ]
        : [];

  const totalSlides = Math.max(normalizedImages.length, 1);
  const activeImage =
    normalizedImages[selectedImageIdx] ?? normalizedImages[0] ?? null;

  const isOutOfStock =
    p.inStock === false ||
    p.stockStatus === "out_of_stock" ||
    p.stockStatus === "OUT_OF_STOCK" ||
    (typeof p.stockQuantity === "number" && p.stockQuantity <= 0) ||
    (typeof p.stock === "number" && p.stock <= 0);

  const priceValue: number =
    typeof p.price === "number"
      ? p.price
      : typeof p.price?.amount === "number"
        ? p.price.amount
        : Number(p.price ?? 0);

  const compareAtValue: number | null =
    typeof p.compareAtPrice === "number"
      ? p.compareAtPrice
      : typeof p.compareAtPrice?.amount === "number"
        ? p.compareAtPrice.amount
        : typeof p.originalPrice === "number"
          ? p.originalPrice
          : null;

  const hasDiscount =
    compareAtValue !== null && compareAtValue > priceValue && priceValue > 0;

  const savingsAmount =
    hasDiscount && compareAtValue !== null ? compareAtValue - priceValue : 0;

  const currency = store?.currency ?? p.currency ?? "PKR";

  const displayPrice =
    typeof p.priceFormatted === "string"
      ? p.priceFormatted
      : typeof p.formattedPrice === "string"
        ? p.formattedPrice
        : formatCurrency(priceValue, currency);

  const displayCompareAt =
    compareAtValue !== null
      ? typeof p.compareAtPriceFormatted === "string"
        ? p.compareAtPriceFormatted
        : typeof p.formattedCompareAtPrice === "string"
          ? p.formattedCompareAtPrice
          : formatCurrency(compareAtValue, currency)
      : null;

  const variantOptions: string[] =
    Array.isArray(p.variants) && p.variants.length > 0
      ? p.variants.map((v: any) => v.title ?? v.name ?? String(v))
      : ["Standard Pack", "Family Pack"];

  const activeNutri = "B";

  return (
    <div className="flex flex-col gap-12 lg:gap-16 font-[family-name:var(--mu-font-family-stack)]">
      {/* Breadcrumb Navigation */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-[length:var(--mu-text-xs)] text-[var(--mu-color-ink-muted)]"
      >
        <Link
          href={homeHref}
          className="hover:text-[var(--mu-color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--mu-color-focus)] rounded-xs"
        >
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={catalogHref}
          className="hover:text-[var(--mu-color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--mu-color-focus)] rounded-xs"
        >
          Catalog
        </Link>
        <span aria-hidden="true">/</span>
        <span
          aria-current="page"
          className="font-medium text-[var(--mu-color-ink)] truncate max-w-[260px]"
        >
          {p.title}
        </span>
      </nav>

      {/* Main Two-Column PDP Grid (design.md §3.5: lg:grid-cols-2 gap-12) */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12 lg:items-start">
        {/* Left Column: Media Frame + Pill-Dot Pager ‹ ▬ ● › */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="relative aspect-square w-full overflow-hidden rounded-[var(--mu-radius-media)] border border-[var(--mu-color-line)] bg-[var(--mu-color-surface)] p-6 sm:p-10 flex items-center justify-center">
            {hasDiscount && (
              <div className="absolute top-4 left-4 z-10">
                <Badge tone="sale">ON SALE</Badge>
              </div>
            )}

            {activeImage?.url ? (
              <img
                src={activeImage.url}
                alt={activeImage.alt || p.title}
                className="h-full w-full object-contain object-center transition-all duration-300"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[var(--mu-radius-sm)] bg-[var(--mu-color-surface-muted)] text-[var(--mu-color-ink-muted)]">
                <IconShoppingBag className="h-12 w-12 opacity-40" />
                <span className="text-[length:var(--mu-text-small)]">
                  Product image preview
                </span>
              </div>
            )}
          </div>

          {/* Pill-Dot Carousel Pager ‹ ▬ ● › (design.md §2.5 & §3.5) */}
          <div className="flex items-center justify-center gap-3 py-1">
            <button
              type="button"
              onClick={() =>
                setSelectedImageIdx(
                  (idx) => (idx - 1 + totalSlides) % totalSlides
                )
              }
              aria-label="Previous image"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--mu-color-line)] text-[var(--mu-color-ink)] hover:border-[var(--mu-color-line-strong)] focus-visible:outline-2 focus-visible:outline-[var(--mu-color-focus)] cursor-pointer"
            >
              &#8249;
            </button>

            <div className="flex items-center gap-2" role="tablist">
              {Array.from({ length: totalSlides }).map((_, idx) => {
                const isSelected = idx === selectedImageIdx;
                return (
                  <button
                    key={idx}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-label={`Image ${idx + 1} of ${totalSlides}`}
                    onClick={() => setSelectedImageIdx(idx)}
                    className={`h-2.5 rounded-full transition-all cursor-pointer ${
                      isSelected
                        ? "w-7 bg-[var(--mu-color-ink)]"
                        : "w-2.5 bg-[var(--mu-color-line)] hover:bg-[var(--mu-color-ink-muted)]"
                    }`}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={() =>
                setSelectedImageIdx((idx) => (idx + 1) % totalSlides)
              }
              aria-label="Next image"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--mu-color-line)] text-[var(--mu-color-ink)] hover:border-[var(--mu-color-line-strong)] focus-visible:outline-2 focus-visible:outline-[var(--mu-color-focus)] cursor-pointer"
            >
              &#8250;
            </button>
          </div>
        </div>

        {/* Right Column: Sticky Buy-Box (design.md §3.5) */}
        <div className="lg:col-span-5 lg:sticky lg:top-20 flex flex-col gap-6">
          {/* 1. Title H1 + Rating Row */}
          <div className="flex flex-col gap-2">
            <h1 className="text-[length:var(--mu-text-h1)] font-normal leading-tight text-[var(--mu-color-ink)]">
              {p.title}
            </h1>

            <div className="flex items-center gap-2 text-[length:var(--mu-text-small)]">
              <span
                className="text-[var(--mu-color-ink)] tracking-tight"
                aria-hidden="true"
              >
                ★★★★★
              </span>
              <span className="text-[var(--mu-color-ink-muted)] underline underline-offset-4">
                ({p.reviewCount ?? 9} reviews)
              </span>
            </div>
          </div>

          {/* 2. Short Bold Subhead + Description */}
          <div className="flex flex-col gap-2">
            <p className="text-[length:var(--mu-text-body)] font-semibold text-[var(--mu-color-ink)]">
              {p.categoryName ?? "Wholesome local selection"}
            </p>
            <p className="text-[length:var(--mu-text-body)] text-[var(--mu-color-ink-soft)] leading-relaxed">
              {p.description ||
                "Crafted in small batches using locally sourced ingredients with zero artificial preservatives."}
            </p>
          </div>

          {/* 3. Nutri-Score Panel (design.md §2.4 & §3.5: bg-surface-muted rounded-sm p-4) */}
          <div className="rounded-[var(--mu-radius-sm)] bg-[var(--mu-color-surface-muted)] p-4 flex flex-col gap-2.5 border border-[var(--mu-color-line)]">
            <div className="flex items-center justify-between text-[length:var(--mu-text-xs)] font-medium text-[var(--mu-color-ink-soft)]">
              <span>Nutriscore &#9432;</span>
              <span>Grade {activeNutri} — High nutritional quality</span>
            </div>
            <div className="grid grid-cols-5 gap-1 pt-1">
              {NUTRI_LETTERS.map((item) => {
                const isActive = item.grade === activeNutri;
                return (
                  <div
                    key={item.grade}
                    className="flex flex-col items-center gap-0.5"
                  >
                    <span
                      aria-hidden="true"
                      className={`text-[10px] leading-none ${
                        isActive
                          ? "text-[var(--mu-color-ink)] opacity-100"
                          : "opacity-0"
                      }`}
                    >
                      &#9660;
                    </span>
                    <div
                      className={`flex w-full items-center justify-center rounded-xs py-1.5 text-xs font-bold ${
                        item.bg
                      } ${isActive ? "ring-2 ring-[var(--mu-color-ink)] scale-105" : "opacity-80"}`}
                    >
                      {item.grade}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. Variant Selector Pill Chips (design.md §2.2) */}
          <fieldset className="flex flex-col gap-2.5">
            <legend className="text-[length:var(--mu-text-small)] font-medium text-[var(--mu-color-ink)]">
              Style:{" "}
              <span className="font-normal text-[var(--mu-color-ink-soft)]">
                {variantOptions[selectedVariant]}
              </span>
            </legend>
            <div className="flex flex-wrap gap-2 pt-1">
              {variantOptions.map((option, idx) => {
                const isSelected = idx === selectedVariant;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedVariant(idx)}
                    className={`h-10 rounded-[var(--mu-radius-pill)] px-5 text-[length:var(--mu-text-small)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mu-color-focus)] ${
                      isSelected
                        ? "border-2 border-[var(--mu-color-line-strong)] font-medium text-[var(--mu-color-ink)] bg-[var(--mu-color-surface)]"
                        : "border border-[var(--mu-color-line)] text-[var(--mu-color-ink-soft)] hover:border-[var(--mu-color-line-strong)]"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* 5. Price Block ($4.99 + strike + "you save", then hairline) */}
          <div className="flex flex-wrap items-baseline gap-3 border-y border-[var(--mu-color-line)] py-4">
            <span className="text-[length:var(--mu-text-price-lg)] font-medium leading-none tracking-[-0.01em] text-[var(--mu-color-ink)]">
              {displayPrice}
            </span>

            {hasDiscount && displayCompareAt && (
              <div className="flex flex-col text-[length:var(--mu-text-xs)] leading-tight">
                <s className="text-[var(--mu-color-ink-muted)]">
                  {displayCompareAt}
                </s>
                <span className="font-medium text-[var(--mu-color-sale)]">
                  You save {formatCurrency(savingsAmount, currency)}
                </span>
              </div>
            )}
          </div>

          {/* 6 & 7. Qty Stepper + Add to Cart Primary Pill + "Buy it now" Outline Pill */}
          <div className="flex flex-col gap-3">
            <AddToCart
              {...(props as any)}
              product={product}
              store={store}
              storePaths={storePaths}
              paths={storePaths}
            />

            <Link
              href={checkoutHref}
              className={buttonVariants({
                variant: "outline",
                size: "md",
                fullWidth: true,
              })}
            >
              Buy it now
            </Link>
          </div>

          {/* 8. Local Store Availability Indicator */}
          <div className="flex items-center gap-3 rounded-[var(--mu-radius-sm)] border border-[var(--mu-color-line)] p-3.5 text-[length:var(--mu-text-small)]">
            <span
              aria-hidden="true"
              className={`h-3 w-3 rounded-full ${
                isOutOfStock
                  ? "bg-[var(--mu-color-sale)]"
                  : "bg-[var(--mu-color-nutri-a)]"
              }`}
            />
            <div>
              <p className="font-medium text-[var(--mu-color-ink)]">
                {isOutOfStock
                  ? "Currently out of stock for local pickup"
                  : `Pickup available at ${store?.name ?? "Local Main Store"}`}
              </p>
              <p className="text-[length:var(--mu-text-xs)] text-[var(--mu-color-ink-muted)]">
                Usually ready in 2 hours &middot; Free curbside collection
              </p>
            </div>
          </div>

          {/* 9. Accordions: Allergens & Ingredients + Shipping/Returns */}
          <div className="border-t border-[var(--mu-color-line)] divide-y divide-[var(--mu-color-line)]">
            {[
              {
                id: "allergens",
                title: "Allergens & Dietary Information",
                content:
                  "Prepared in a facility that handles tree nuts, gluten-free oats, and organic seeds. 100% plant-based and non-GMO verified.",
              },
              {
                id: "shipping",
                title: "Local Delivery & Returns",
                content:
                  "Same-day local delivery on orders placed before 2:00 PM. Freshness guaranteed or instant replacement.",
              },
            ].map((acc) => {
              const isOpen = openAccordion === acc.id;
              return (
                <div key={acc.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenAccordion(isOpen ? null : acc.id)
                    }
                    className="flex w-full items-center justify-between py-4 text-left text-[length:var(--mu-text-body)] font-medium text-[var(--mu-color-ink)] hover:text-[var(--mu-color-brand-text)] focus-visible:outline-2 focus-visible:outline-[var(--mu-color-focus)] cursor-pointer"
                  >
                    <span>{acc.title}</span>
                    <span className="text-xl leading-none" aria-hidden="true">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="pb-5 text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-soft)] leading-relaxed">
                      {acc.content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Below Fold: "You may also like" 4-up Product Grid */}
      {relatedProducts.length > 0 && (
        <section
          aria-labelledby="mu-related-heading"
          className="flex flex-col gap-6 border-t border-[var(--mu-color-line)] pt-12"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2
              id="mu-related-heading"
              className="text-[length:var(--mu-text-h2)] font-normal text-[var(--mu-color-ink)]"
            >
              You may also like
            </h2>
            <Link
              href={catalogHref}
              className="text-[length:var(--mu-text-body)] text-[var(--mu-color-ink)] underline underline-offset-4 decoration-1 hover:text-[var(--mu-color-brand-text)]"
            >
              View all products
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {relatedProducts.slice(0, 4).map((rel: any) => (
              <ProductCard
                key={rel.id ?? rel.slug}
                product={rel}
                store={store}
                storePaths={storePaths}
                paths={storePaths}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export const MustafaProductPage = ProductPage;
export default ProductPage;
