"use client";

import { useMemo } from "react";
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

/** Providers only. The pages render Header and Footer themselves, as the original pages did, so no DOM is added here. */
export function Layout({ store, chrome, mode, children }: StoreLayoutProps) {
  const data = useMemo<StoreData>(
    () => ({ name: store.name, logoUrl: store.logoUrl, announcement: store.announcement, currency: store.currency, locale: store.locale, mode: mode ?? "live" }),
    [store, mode],
  );
  const categories = useMemo(() => (chrome?.categories ?? []).map(toStilettoCategory), [chrome]);
  const products = useMemo(() => (chrome?.products ?? []).map((p) => toStilettoProduct(p)), [chrome]);
  const content = useMemo(() => buildStilettoContent(data, categories), [data, categories]);
  const value = useMemo(() => ({ store: data, content, categories }), [data, content, categories]);

  return (
    <>
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
    </>
  );
}
