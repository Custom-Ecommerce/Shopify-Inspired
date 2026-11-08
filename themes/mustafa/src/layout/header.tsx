"use client";

import * as React from "react";
import Link from "next/link";
import type { StoreLayoutProps } from "@markaz/storefront-theme-kit";
import { MiniCart } from "../components/mini-cart";
import { MobileNav } from "../components/mobile-nav";
import { SearchBar } from "../components/search-bar";
import { buttonVariants } from "../components/ui/button";
import { IconSearch, IconTruck, IconX } from "../components/ui/icons";

const ANNOUNCEMENTS = [
  "Save 20% on seasonal organic boxes — use code: BULKSAVE",
  "Free local doorstep delivery on orders over Rs. 2,500",
  "100% farm-fresh produce sourced daily from local growers",
];

export function Header(props: StoreLayoutProps) {
  const store = (props as any).store;
  const storePaths = (props as any).storePaths ?? (props as any).paths ?? {};
  const navigation = (props as any).navigation;

  const [announcementIdx, setAnnouncementIdx] = React.useState(0);
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false);

  const homeHref: string = storePaths.home ?? "/";
  const catalogHref: string =
    storePaths.catalog ?? storePaths.products ?? "/products";
  const trackHref: string =
    storePaths.orderTracking ?? storePaths.track ?? "/track";
  const searchHref: string = storePaths.search ?? "/search";
  const cartHref: string = storePaths.cart ?? "/cart";

  const rawNav =
    navigation?.header ??
    navigation?.items ??
    (props as any).navItems ??
    [];

  const navLinks: Array<{ label: string; href: string }> =
    Array.isArray(rawNav) && rawNav.length > 0
      ? rawNav
      : [
          { label: "Categories", href: catalogHref },
          { label: "Fresh Bakery", href: `${catalogHref}?category=bakery` },
          { label: "Superfoods", href: `${catalogHref}?category=superfoods` },
          { label: "Track Order", href: trackHref },
        ];

  // Scroll collapse behavior (design.md §3.1: hide Row 1 on scroll down past 120px)
  React.useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY;
          if (currentY > 140 && currentY > lastY) {
            setCollapsed(true);
          } else if (currentY < 80 || currentY < lastY - 12) {
            setCollapsed(false);
          }
          lastY = currentY;
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-collapsed={collapsed ? "true" : "false"}
      className="sticky top-0 z-40 w-full bg-[var(--mu-color-surface)] text-[var(--mu-color-ink)] font-[family-name:var(--mu-font-family-stack)] border-b border-[var(--mu-color-line)]"
    >
      {/* Announcement Bar (design.md §3.1: bg-surface-inverse #1d1d1d, ~36px tall, rotator) */}
      <div
        className={`bg-[var(--mu-color-surface-inverse)] text-[var(--mu-color-ink-inverse)] transition-all duration-200 overflow-hidden ${
          collapsed ? "max-h-0 py-0 opacity-0" : "max-h-12 py-2 opacity-100"
        }`}
      >
        <div className="mx-auto flex max-w-[var(--mu-container-page)] items-center justify-between px-[var(--mu-gutter)] text-[length:var(--mu-text-xs)]">
          {/* Left Social / Contact Links (Desktop) */}
          <div className="hidden md:flex items-center gap-4 text-[var(--mu-color-ink-inverse-muted)]">
            <Link
              href={trackHref}
              className="hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-white rounded-xs"
            >
              Order Lookup
            </Link>
            <span aria-hidden="true">&middot;</span>
            <span>Daily Local Dispatch</span>
          </div>

          {/* Center Rotator Message */}
          <div className="flex items-center justify-center gap-3 mx-auto md:mx-0">
            <button
              type="button"
              onClick={() =>
                setAnnouncementIdx(
                  (prev) =>
                    (prev - 1 + ANNOUNCEMENTS.length) % ANNOUNCEMENTS.length
                )
              }
              aria-label="Previous announcement"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--mu-color-ink-inverse-muted)] hover:text-white focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
            >
              &#8249;
            </button>
            <p
              aria-live="polite"
              className="font-medium tracking-wide text-center truncate max-w-[260px] sm:max-w-md"
            >
              {ANNOUNCEMENTS[announcementIdx]}
            </p>
            <button
              type="button"
              onClick={() =>
                setAnnouncementIdx((prev) => (prev + 1) % ANNOUNCEMENTS.length)
              }
              aria-label="Next announcement"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--mu-color-ink-inverse-muted)] hover:text-white focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
            >
              &#8250;
            </button>
          </div>

          {/* Right Locale / Currency Indicator */}
          <div className="hidden md:flex items-center gap-3 text-[var(--mu-color-ink-inverse-muted)]">
            <span>English &#9662;</span>
            <span>{store?.currency ?? "PKR"}</span>
          </div>
        </div>
      </div>

      {/* Desktop Row 1 (h≈80px): Logo Left · Search Pill Center-Left · Account Outline Pill · Cart Primary Pill */}
      <div
        className={`mx-auto max-w-[var(--mu-container-page)] px-[var(--mu-gutter)] transition-all duration-200 ${
          collapsed
            ? "lg:max-h-0 lg:py-0 lg:opacity-0 lg:overflow-hidden"
            : "py-3 lg:py-4"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          {/* Mobile Left Controls: Burger + Search Toggle */}
          <div className="flex items-center gap-1.5 lg:hidden">
            <MobileNav
              {...(props as any)}
              store={store}
              storeName={store?.name ?? "Local"}
              storePaths={storePaths}
              paths={storePaths}
              links={navLinks}
              items={navLinks}
            />
            <button
              type="button"
              onClick={() => setMobileSearchOpen((v) => !v)}
              aria-expanded={mobileSearchOpen}
              aria-label={mobileSearchOpen ? "Close search" : "Open search"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--mu-color-ink)] hover:bg-[var(--mu-color-surface-muted)] focus-visible:outline-2 focus-visible:outline-[var(--mu-color-focus)] cursor-pointer"
            >
              {mobileSearchOpen ? (
                <IconX className="h-5 w-5" />
              ) : (
                <IconSearch className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* Brand Logo ("Local" script/geometric wordmark) */}
          <div className="flex items-center lg:min-w-[160px]">
            <Link
              href={homeHref}
              className="inline-flex items-center gap-2 text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--mu-color-ink)] hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--mu-color-focus)] rounded-sm"
            >
              {store?.logoUrl ? (
                <img
                  src={store.logoUrl}
                  alt={store?.name ?? "Local"}
                  className="h-9 w-auto max-w-[150px] object-contain"
                />
              ) : (
                <span className="italic font-serif tracking-normal">
                  {store?.name ?? "Local"}
                </span>
              )}
            </Link>
          </div>

          {/* Desktop Pill Search Input (~360px) */}
          <div className="hidden lg:block flex-1 max-w-md mx-4">
            <SearchBar
              {...(props as any)}
              storePaths={storePaths}
              paths={storePaths}
              searchPath={searchHref}
              action={searchHref}
              placeholder="Search for fresh bread, organic produce..."
            />
          </div>

          {/* Right Actions: Track/Account Outline Pill + Primary Cart Pill */}
          <div className="flex items-center justify-end gap-2.5">
            <Link
              href={trackHref}
              className={`hidden sm:inline-flex ${buttonVariants({
                variant: "outline",
                size: "sm",
              })}`}
            >
              Track Order
            </Link>

            <MiniCart
              {...(props as any)}
              store={store}
              storePaths={storePaths}
              paths={storePaths}
              cartHref={cartHref}
              checkoutHref={storePaths.checkout ?? "/checkout"}
              currency={store?.currency ?? "PKR"}
            />
          </div>
        </div>

        {/* Mobile Collapsible Search Bar */}
        {mobileSearchOpen && (
          <div className="mt-3 pt-3 border-t border-[var(--mu-color-line)] lg:hidden">
            <SearchBar
              {...(props as any)}
              storePaths={storePaths}
              paths={storePaths}
              searchPath={searchHref}
              action={searchHref}
              placeholder="Search for products..."
            />
          </div>
        )}
      </div>

      {/* Desktop Row 2 (h≈56px, always sticky): Nav Links Left · Store Picker & Delivery Estimator Right */}
      <div className="hidden lg:block border-t border-[var(--mu-color-line)] bg-[var(--mu-color-surface)]">
        <div className="mx-auto flex h-14 max-w-[var(--mu-container-page)] items-center justify-between px-[var(--mu-gutter)]">
          {/* Primary Nav Links */}
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-7"
          >
            {navLinks.map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className="text-[length:var(--mu-text-body)] font-normal text-[var(--mu-color-ink)] hover:text-[var(--mu-color-brand-text)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--mu-color-focus)] rounded-xs py-1"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right Store Picker + Delivery Estimator + Sticky Cart Pill when Row 1 is collapsed */}
          <div className="flex items-center gap-6">
            <Link
              href={catalogHref}
              className="group flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mu-color-focus)] rounded-sm"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mu-color-surface-muted)] text-[var(--mu-color-ink)]">
                &#127978;
              </span>
              <div className="leading-tight">
                <span className="block text-[length:var(--mu-text-xs)] text-[var(--mu-color-ink-muted)]">
                  Picking up?
                </span>
                <span className="text-[length:var(--mu-text-small)] font-medium text-[var(--mu-color-ink)] group-hover:text-[var(--mu-color-brand-text)]">
                  {store?.name ?? "Local Main Store"} &#9662;
                </span>
              </div>
            </Link>

            <Link
              href={trackHref}
              className="group flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mu-color-focus)] rounded-sm"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mu-color-surface-muted)] text-[var(--mu-color-ink)]">
                <IconTruck className="h-4 w-4" />
              </span>
              <div className="leading-tight">
                <span className="block text-[length:var(--mu-text-xs)] text-[var(--mu-color-ink-muted)]">
                  Need delivery?
                </span>
                <span className="text-[length:var(--mu-text-small)] font-medium text-[var(--mu-color-ink)] group-hover:text-[var(--mu-color-brand-text)]">
                  Same-day local
                </span>
              </div>
            </Link>

            {collapsed && (
              <MiniCart
                {...(props as any)}
                store={store}
                storePaths={storePaths}
                paths={storePaths}
                cartHref={cartHref}
                checkoutHref={storePaths.checkout ?? "/checkout"}
                currency={store?.currency ?? "PKR"}
              />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
