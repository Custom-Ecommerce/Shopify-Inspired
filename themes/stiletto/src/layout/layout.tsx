"use client";

import { useMemo } from "react";
import type React from "react";
import type { StoreLayoutProps } from "@markaz/storefront-theme-kit";
import { UIProvider } from "../shared/context/UIContext";
import { CartProvider } from "../shared/context/CartContext";
import { StoreDataProvider } from "../shared/context/StoreDataContext";
import { WatermarkBackground } from "../shared/components/watermark/WatermarkBackground";
import { StilettoChromeProvider } from "../adapters/chrome-context";
import { toStilettoCategory, toStilettoProduct } from "../adapters/product";
import { STILETTO_LOGO } from "../adapters/images";
import { buildStilettoContent } from "../content";
import { SourceBadges } from "../badges/source-badges";
import type { StoreData } from "../model";
import { stilettoThemeView } from "../content/theme-config";

/** Providers only. The pages render Header and Footer themselves, as the original pages did, so no DOM is added here. */
export function Layout({ store, footer, chrome, mode, children }: StoreLayoutProps) {
  const data = useMemo<StoreData>(
    () => ({ name: store.name, logoUrl: store.logoUrl, announcement: store.announcement, currency: store.currency, locale: store.locale, mode: mode ?? "live", description: store.description ?? null, bannerUrl: store.bannerUrl ?? null, contact: store.contact, social: store.social ?? null, deliveryEstimate: store.deliveryEstimate ?? null, themeConfig: store.themeConfig ?? null }),
    [store, mode],
  );
  const categories = useMemo(() => (chrome?.categories ?? []).map(toStilettoCategory), [chrome]);
  const products = useMemo(() => (chrome?.products ?? []).map((p) => toStilettoProduct(p)), [chrome]);
  // Sprint 7 (S7-B3): the footer links the store's content adds (published pages shown in the footer, and the blog).
  const storeLinks = useMemo(() => (footer?.links ?? []).filter((link) => link.href === "/blog" || link.href.startsWith("/pages/")), [footer]);
  const content = useMemo(() => buildStilettoContent(data, categories, storeLinks), [data, categories, storeLinks]);
  const value = useMemo(() => ({ store: data, content, categories }), [data, content, categories]);

  // Sprint 7 (S7-B7): colours and the font reach the page as CSS custom properties built from the VALIDATED config only (stilettoThemeView -> themeStyleVars).
  // `display: contents` keeps the layout exactly as it was. The variables are inherited by everything inside this element; a drawer that a library portals to <body>
  // sits outside it and keeps the theme's own colours (a known limit, noted in the S7-B7 report).
  const view = useMemo(() => stilettoThemeView(data), [data]);

  return (
    <div style={view.style as React.CSSProperties} className="contents" data-themed={Object.keys(view.style).length > 0 ? "true" : undefined}>
      <WatermarkBackground logoUrl={store.logoUrl ?? STILETTO_LOGO} />
      <StoreDataProvider categories={categories} products={products} store={data}>
        <UIProvider>
          <CartProvider>
            <StilettoChromeProvider value={value}>
              {children}
              <SourceBadges mode={data.mode} />
            </StilettoChromeProvider>
          </CartProvider>
        </UIProvider>
      </StoreDataProvider>
    </div>
  );
}
