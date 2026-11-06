"use client";

import * as React from "react";
import Link from "next/link";
import type { HomePageProps } from "@markaz/storefront-theme-kit";
import { Card } from "../components/ui/card";
import { buttonVariants } from "../components/ui/button";
import { ProductCard } from "../components/product-card";

const CATEGORY_TILES = [
  {
    eyebrow: "Fresh everyday",
    title: "Finest Bread",
    variant: "cream" as const,
    emoji: "🥖",
    query: "bakery",
  },
  {
    eyebrow: "Just arrived!",
    title: "Superfoods",
    variant: "mint" as const,
    emoji: "🥑",
    query: "superfoods",
  },
  {
    eyebrow: "Collection",
    title: "Pure Organic",
    variant: "sky" as const,
    emoji: "🍯",
    query: "organic",
  },
];

export function HomePage(props: HomePageProps) {
  const store = (props as any).store;
  const storePaths = (props as any).storePaths ?? (props as any).paths ?? {};
  const catalogHref: string =
    storePaths.catalog ?? storePaths.products ?? "/products";

  const featuredProducts: any[] =
    (props as any).featuredProducts ??
    (props as any).products ??
    (props as any).catalog?.products ??
    (props as any).catalog?.items ??
    [];

  return (
    <div className="flex flex-col gap-14 lg:gap-20 font-[family-name:var(--mu-font-family-stack)]">
      {/* 1. Hero Section (design.md §3.3: bg-surface-hero #eff0eb, green 5-star row, 3 stacked lines, diagonal sage shape) */}
      <section className="relative overflow-hidden rounded-[var(--mu-radius-card)] bg-[var(--mu-color-surface-hero)] min-h-[460px] lg:min-h-[540px] flex items-center">
        {/* Diagonal Sage Green Decorative Shape (design.md §3.3) */}
        <div
          aria-hidden="true"
          style={{ clipPath: "polygon(28% 0%, 100% 0%, 100% 100%, 0% 100%)" }}
          className="pointer-events-none absolute right-0 top-0 bottom-0 hidden lg:block w-[46%] bg-[var(--mu-color-brand)]/35"
        />

        <div className="relative z-10 grid w-full grid-cols-1 gap-8 p-6 sm:p-10 lg:grid-cols-12 lg:p-14 items-center">
          {/* Left Hero Copy */}
          <div className="lg:col-span-7 flex flex-col items-start gap-6">
            <div
              role="img"
              aria-label="Rated 4.9 out of 5 stars from 589 local shoppers"
              className="inline-flex items-center gap-2 rounded-[var(--mu-radius-pill)] bg-[var(--mu-color-surface)]/90 px-4 py-1.5 text-[length:var(--mu-text-small)] font-medium text-[var(--mu-color-ink)] border border-[var(--mu-color-line)]"
            >
              <span className="text-[var(--mu-color-brand-text)] tracking-tight">
                ★★★★★
              </span>
              <span>4.9 (589)</span>
            </div>

            <h1 className="text-[length:var(--mu-text-hero)] font-light leading-[1.02] tracking-[-0.02em] text-[var(--mu-color-ink)]">
              <span className="block">Fresh.</span>
              <span className="block">Organic.</span>
              <span className="block font-normal">Delivered.</span>
            </h1>

            <p className="text-[length:var(--mu-text-body)] sm:text-lg text-[var(--mu-color-ink-soft)] max-w-xl leading-relaxed">
              {store?.description ||
                `Hand-picked seasonal produce, artisan bakery, and wholesome pantry staples from ${store?.name ?? "Local"} delivered straight to your door.`}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href={catalogHref}
                className={buttonVariants({ variant: "primary", size: "lg" })}
              >
                Explore Catalog
              </Link>
              <Link
                href={storePaths.orderTracking ?? storePaths.track ?? "/track"}
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Track Delivery
              </Link>
            </div>
          </div>

          {/* Right Hero Visual Packshot */}
          <div className="lg:col-span-5 flex items-center justify-center">
            <div className="relative flex aspect-square w-full max-w-[360px] flex-col items-center justify-center rounded-[var(--mu-radius-card)] bg-[var(--mu-color-surface)]/95 p-8 border border-[var(--mu-color-line)] shadow-sm text-center">
              <span className="text-7xl mb-4" aria-hidden="true">
                🧺
              </span>
              <p className="text-[length:var(--mu-text-xs)] font-semibold uppercase tracking-widest text-[var(--mu-color-brand-text)]">
                100% Local Harvest
              </p>
              <p className="mt-1 text-[length:var(--mu-text-h3)] font-medium text-[var(--mu-color-ink)]">
                Farm-to-Table Daily Box
              </p>
              <p className="mt-1 text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-muted)]">
                Harvested within 24 hours of dispatch
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Category Pastel Tiles (3-up, design.md §3.3: cream / mint / sky) */}
      <section aria-label="Featured categories">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {CATEGORY_TILES.map((tile) => (
            <Card
              key={tile.title}
              variant={tile.variant}
              padding="lg"
              className="flex flex-col items-center justify-between text-center min-h-[320px] transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className="flex flex-col items-center gap-2">
                <span className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-soft)]">
                  {tile.eyebrow}
                </span>
                <h2 className="text-3xl font-normal tracking-tight text-[var(--mu-color-ink)]">
                  {tile.title}
                </h2>
                <div className="pt-3">
                  <Link
                    href={`${catalogHref}?category=${tile.query}`}
                    className={buttonVariants({
                      variant: "primary",
                      size: "sm",
                    })}
                  >
                    Show more
                  </Link>
                </div>
              </div>

              <div
                aria-hidden="true"
                className="mt-6 flex h-28 w-28 items-center justify-center rounded-full bg-white/75 text-5xl shadow-xs"
              >
                {tile.emoji}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* 3. Featured Collection Row (design.md §3.3: H2 left, "View all products" underlined right, 4-up grid) */}
      <section
        aria-labelledby="mu-home-featured-heading"
        className="flex flex-col gap-6"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2
            id="mu-home-featured-heading"
            className="text-[length:var(--mu-text-h2)] font-normal tracking-[-0.01em] text-[var(--mu-color-ink)]"
          >
            Fresh Arrivals &amp; Local Favorites
          </h2>
          <Link
            href={catalogHref}
            className="text-[length:var(--mu-text-body)] text-[var(--mu-color-ink)] underline underline-offset-4 decoration-1 hover:text-[var(--mu-color-brand-text)]"
          >
            View all products
          </Link>
        </div>

        {featuredProducts.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {featuredProducts.slice(0, 8).map((product: any) => (
              <ProductCard
                key={product.id ?? product.slug}
                product={product}
                store={store}
                storePaths={storePaths}
                paths={storePaths}
              />
            ))}
          </div>
        ) : (
          <Card
            variant="muted"
            padding="lg"
            className="flex flex-col items-center justify-center text-center gap-4 py-14"
          >
            <p className="text-[length:var(--mu-text-h3)] text-[var(--mu-color-ink)]">
              Our fresh catalog is ready to explore
            </p>
            <p className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-muted)] max-w-md">
              Browse all categories and seasonal items in our full catalog view.
            </p>
            <Link
              href={catalogHref}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              Browse All Products
            </Link>
          </Card>
        )}
      </section>

      {/* 4. "We promise!" Promo Banners (design.md §3.3: 2 large rounded-card tiles) */}
      <section
        aria-labelledby="mu-promise-heading"
        className="flex flex-col gap-6"
      >
        <h2
          id="mu-promise-heading"
          className="text-[length:var(--mu-text-h2)] font-normal tracking-[-0.01em] text-[var(--mu-color-ink)]"
        >
          We promise!
        </h2>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-[var(--mu-radius-card)] bg-[var(--mu-color-tile-cream)] p-8 sm:p-10 min-h-[260px] flex flex-col justify-end border border-[var(--mu-color-line)]">
            <span className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-soft)]">
              Every day
            </span>
            <h3 className="mt-1 text-2xl sm:text-3xl font-normal text-[var(--mu-color-ink)]">
              Fresh artisan bakery &amp; stone-milled grains
            </h3>
            <div className="mt-5">
              <Link
                href={catalogHref}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Shop Bakery
              </Link>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[var(--mu-radius-card)] bg-[var(--mu-color-tile-mint)] p-8 sm:p-10 min-h-[260px] flex flex-col justify-end border border-[var(--mu-color-line)]">
            <span className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-soft)]">
              Hand-picked
            </span>
            <h3 className="mt-1 text-2xl sm:text-3xl font-normal text-[var(--mu-color-ink)]">
              Certified organic fruits &amp; crisp vegetables
            </h3>
            <div className="mt-5">
              <Link
                href={catalogHref}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Shop Produce
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export const MustafaHomePage = HomePage;
export default HomePage;
