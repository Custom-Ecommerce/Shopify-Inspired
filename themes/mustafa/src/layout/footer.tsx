import * as React from "react";
import Link from "next/link";
import type { StoreLayoutProps } from "@markaz/storefront-theme-kit";

const USP_ITEMS = [
  {
    icon: "⚡",
    text: "Get orders faster while avoiding extra shipping fees",
  },
  {
    icon: "♻️",
    text: "100% curbside recyclable & eco-conscious packaging",
  },
  {
    icon: "🌱",
    text: "Supporting small local farmers, bakers, and producers",
  },
  {
    icon: "🥗",
    text: "Feel great about what you eat with transparent sourcing",
  },
];

export function Footer(props: StoreLayoutProps) {
  const store = (props as any).store;
  const storePaths = (props as any).storePaths ?? (props as any).paths ?? {};
  const navigation = (props as any).navigation;

  const homeHref: string = storePaths.home ?? "/";
  const catalogHref: string =
    storePaths.catalog ?? storePaths.products ?? "/products";
  const searchHref: string = storePaths.search ?? "/search";
  const cartHref: string = storePaths.cart ?? "/cart";
  const trackHref: string =
    storePaths.orderTracking ?? storePaths.track ?? "/track";

  const rawFooter = navigation?.footer ?? [];
  const quickLinks: Array<{ label: string; href: string }> =
    Array.isArray(rawFooter) && rawFooter.length > 0
      ? rawFooter
      : [
          { label: "Search", href: searchHref },
          { label: "All Products", href: catalogHref },
          { label: "Shopping Cart", href: cartHref },
          { label: "Track Order", href: trackHref },
        ];

  const categories = [
    { label: "Bread & Bakery", href: `${catalogHref}?category=bakery` },
    { label: "Dairy & Eggs", href: `${catalogHref}?category=dairy` },
    { label: "Superfoods & Organic", href: `${catalogHref}?category=organic` },
    { label: "Fruits & Vegetables", href: `${catalogHref}?category=produce` },
    { label: "Pantry Essentials", href: catalogHref },
  ];

  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto font-[family-name:var(--mu-font-family-stack)]">
      {/* 1. USP Promise Strip (design.md §3.2: bg-surface-muted #f6f6f4, 4 columns) */}
      <div className="bg-[var(--mu-color-surface-muted)] border-t border-[var(--mu-color-line)] py-10">
        <div className="mx-auto max-w-[var(--mu-container-page)] px-[var(--mu-gutter)]">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {USP_ITEMS.map((item, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center text-center gap-3 px-4"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--mu-color-surface)] border border-[var(--mu-color-line)] text-xl"
                >
                  {item.icon}
                </span>
                <p className="text-[length:var(--mu-text-small)] font-normal text-[var(--mu-color-ink)] max-w-[240px] leading-snug">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Dark 5-Column Footer (design.md §3.2: bg-surface-inverse #1d1d1d, text-white, py-16) */}
      <div className="bg-[var(--mu-color-surface-inverse)] text-[var(--mu-color-ink-inverse)] py-16">
        <div className="mx-auto max-w-[var(--mu-container-page)] px-[var(--mu-gutter)]">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-5">
            {/* Col 1: Brand Wordmark + Tagline */}
            <div className="flex flex-col gap-4">
              <Link
                href={homeHref}
                className="text-2xl font-bold uppercase tracking-wider text-white hover:opacity-85 focus-visible:outline-2 focus-visible:outline-white rounded-xs w-fit"
              >
                {store?.name ?? "LOCAL"}
              </Link>
              <p className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-inverse-muted)] leading-relaxed">
                {store?.description ||
                  "Fresh products from local producers, delivered directly to your front door, daily."}
              </p>
            </div>

            {/* Col 2: Quick Links */}
            <div className="flex flex-col gap-4">
              <h2 className="text-[length:var(--mu-text-h3)] font-normal text-white">
                Quick links
              </h2>
              <ul className="flex flex-col gap-2.5">
                {quickLinks.map((item) => (
                  <li key={item.href + item.label}>
                    <Link
                      href={item.href}
                      className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-inverse-muted)] underline underline-offset-4 decoration-1 hover:text-white hover:decoration-2 transition-colors focus-visible:outline-2 focus-visible:outline-white rounded-xs"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Col 3: Popular Categories */}
            <div className="flex flex-col gap-4">
              <h2 className="text-[length:var(--mu-text-h3)] font-normal text-white">
                Popular categories
              </h2>
              <ul className="flex flex-col gap-2.5">
                {categories.map((cat) => (
                  <li key={cat.label}>
                    <Link
                      href={cat.href}
                      className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-inverse-muted)] underline underline-offset-4 decoration-1 hover:text-white hover:decoration-2 transition-colors focus-visible:outline-2 focus-visible:outline-white rounded-xs"
                    >
                      {cat.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Col 4: Main Store Address Block */}
            <div className="flex flex-col gap-4">
              <h2 className="text-[length:var(--mu-text-h3)] font-normal text-white">
                Main Store
              </h2>
              <address className="not-italic text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-inverse-muted)] space-y-2 leading-relaxed">
                <p className="text-white font-medium">
                  {store?.name ?? "Local Flagship Market"}
                </p>
                <p>Open daily: 8:00 AM – 10:00 PM</p>
                <p>Same-day pickup &amp; local courier dispatch</p>
              </address>
            </div>

            {/* Col 5: Pill Newsletter Form */}
            <div className="flex flex-col gap-4">
              <h2 className="text-[length:var(--mu-text-h3)] font-normal text-white">
                Newsletter
              </h2>
              <p className="text-[length:var(--mu-text-small)] text-[var(--mu-color-ink-inverse-muted)] leading-relaxed">
                Subscribe for seasonal harvest drops, recipes, and exclusive local offers.
              </p>
              <form
                onSubmit={(e) => e.preventDefault()}
                className="relative flex items-center"
              >
                <label htmlFor="mu-footer-newsletter" className="sr-only">
                  Enter your email
                </label>
                <input
                  id="mu-footer-newsletter"
                  type="email"
                  placeholder="Enter your email"
                  className="h-11 w-full rounded-[var(--mu-radius-pill)] border border-white/25 bg-transparent pl-4 pr-12 text-[length:var(--mu-text-small)] text-white placeholder:text-[var(--mu-color-ink-inverse-muted)] focus-visible:border-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                />
                <button
                  type="submit"
                  aria-label="Subscribe to newsletter"
                  className="absolute right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[var(--mu-color-ink)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
                >
                  &#10148;
                </button>
              </form>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="mt-14 pt-8 border-t border-white/15 flex flex-col sm:flex-row items-center justify-between gap-4 text-[length:var(--mu-text-xs)] text-[var(--mu-color-ink-inverse-muted)]">
            <p>
              &copy; {year} {store?.name ?? "LOCAL"}. Powered by Local Storefront Theme.
            </p>
            <div className="flex items-center gap-4">
              <span>Currency: {store?.currency ?? "PKR"}</span>
              <span aria-hidden="true">&middot;</span>
              <span>WCAG 2.2 AA Accessible</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
