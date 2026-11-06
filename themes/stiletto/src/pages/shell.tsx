"use client";

import { Footer } from "../components/footer/Footer";
import { Header } from "../components/header/Header";
import { useStilettoChrome } from "../adapters/chrome-context";

/** Header with the props the original pages passed it, built from the store and its categories. */
export function StilettoHeader() {
  const { content, categories } = useStilettoChrome();
  const nav = content.navConfig;
  return (
    <Header
      announcement={nav.announcement}
      brand={nav.brand}
      navLinks={nav.navLinks}
      categories={categories}
      searchDrawerData={nav.searchDrawer}
      cartDrawerData={nav.cartDrawer}
      menuLogo={nav.menuLogo}
    />
  );
}

export function StilettoFooter() {
  const { content } = useStilettoChrome();
  return <Footer config={content.footerConfig} />;
}
