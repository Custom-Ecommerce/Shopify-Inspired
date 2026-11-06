"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, User } from "lucide-react";
import { Button } from "../../shared/components/primitives/button";
import { AnnouncementBar } from "./AnnouncementBar";
import { MegaMenu } from "./MegaMenu";
import { MobileMenuSheet } from "./MobileMenuSheet";
import { SearchDrawer } from "./SearchDrawer";
import { CartDrawer } from "./CartDrawer";
import { useScrollState } from "../../shared/hooks/useScrollState";
import type { HeaderProps } from "../../types";
import { BrandDisplay } from "../../components/brand/BrandDisplay";

export function Header({
  announcement,
  brand,
  navLinks,
  categories,
  searchDrawerData,
  cartDrawerData,
  menuLogo
}: HeaderProps) {
  const pathname = usePathname();
  const isHomePage = pathname === "/";

  const isScrolled = useScrollState(50);

  // Track strictly which category is hovered
  const [activeMenuLabel, setActiveMenuLabel] = useState<string | null>(null);

  // 🌟 Case-Insensitive & Flexible Category Lookup
  const activeCategory = categories?.find((c) => {
    if (!activeMenuLabel || !c.title) return false;
    const cleanCategoryTitle = c.title.trim().toLowerCase();
    const cleanLinkLabel = activeMenuLabel.trim().toLowerCase();
    
    return (
      cleanCategoryTitle === cleanLinkLabel ||
      cleanCategoryTitle.includes(cleanLinkLabel) ||
      cleanLinkLabel.includes(cleanCategoryTitle)
    );
  }) || null;

  // Solid background is locked TRUE on non-homepage routes
  const isSolid = !isHomePage || isScrolled || activeMenuLabel !== null;

  const navBgClass = isSolid
    ? "bg-[var(--nav-solid-bg)] border-[var(--nav-solid-border)]"
    : "bg-transparent border-transparent";
  const navTextClass = isSolid
    ? "text-[var(--nav-solid-text)]"
    : "text-[var(--nav-transparent-text)]";

  return (
    <header
      data-source="partial" data-source-note="Logo and navigation come from the store's name, logo and categories; icons and layout are theme design." data-section="header" className="fixed top-0 w-full z-50 transition-all duration-500"
      onMouseLeave={() => setActiveMenuLabel(null)}
    >
      {announcement && announcement.messages && announcement.messages.length > 0 && (
        <AnnouncementBar announcement={announcement} />
      )}

      <nav className={`border-b relative h-16 md:h-[84px] flex items-center transition-colors duration-500 ${navBgClass} ${navTextClass}`}>
        <div className="px-6 md:px-12 w-full max-w-container-max mx-auto flex items-center justify-between">

          {/* Desktop Logo cleanly aligned to left padding boundary */}
          <div className="flex items-center">
            <MobileMenuSheet brand={brand} navLinks={navLinks} menuLogo={menuLogo} />
            <div className="hidden md:block h-12 w-auto">
              <BrandDisplay brand={brand} className="h-full w-auto" />
            </div>
          </div>

          {/* Mobile Logo Centered */}
          <div className="md:hidden absolute left-1/2 -translate-x-1/2 h-12 w-24">
            <BrandDisplay brand={brand} className="h-full w-full" />
          </div>

          {/* Center Links Container - ONLY rendered on Homepage */}
          {isHomePage && (
            <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-8 h-full">
              {navLinks.map((link, idx) => (
                <div
                  key={`${link.label}-${idx}`}
                  className="h-full flex items-center"
                  onMouseEnter={() => {
                    if (link.hasMegaMenu) {
                      setActiveMenuLabel(link.label);
                    } else {
                      setActiveMenuLabel(null);
                    }
                  }}
                >
                  <Link
                    href={link.href}
                    className="font-sans text-[12px] uppercase tracking-[0.08em] hover:opacity-60 transition-opacity flex items-center gap-[2px] font-medium text-inherit"
                  >
                    {link.label}
                    {link.hasMegaMenu && (
                      <ChevronDown className="size-5 opacity-70 mt-[2px]" />
                    )}
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Right Action Drawers */}
          <div className="flex items-center gap-1 md:gap-3">
            <SearchDrawer data={searchDrawerData} />
            <Button variant="ghost" size="icon" className="hover:opacity-60 transition-opacity text-inherit hidden md:flex">
              <User className="size-6 md:size-8" strokeWidth={1.25} />
            </Button>
            <CartDrawer data={cartDrawerData} />
          </div>
        </div>

        {/* MegaMenu renders ONLY on homepage */}
        {isHomePage && (
          <MegaMenu
            isOpen={activeMenuLabel !== null && activeCategory !== null}
            category={activeCategory}
          />
        )}
      </nav>
    </header>
  );
}