"use client";

import * as React from "react";
import type { ThemeLayoutProps } from "@markaz/storefront-theme-kit";
import { Header } from "./header";
import { Footer } from "./footer";

export function Layout(props: ThemeLayoutProps) {
  const { children } = props;

  return (
    <div
      data-theme="mustafa"
      className="mu-theme min-h-screen flex flex-col bg-[var(--mu-color-surface)] text-[var(--mu-color-ink)] font-[family-name:var(--mu-font-family-stack)] selection:bg-[var(--mu-color-brand-soft)] selection:text-[var(--mu-color-ink)]"
    >
      <a
        href="#mu-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-[var(--mu-radius-pill)] focus:bg-[var(--mu-color-ink)] focus:px-5 focus:py-2.5 focus:text-white focus:outline-2 focus:outline-[var(--mu-color-focus)]"
      >
        Skip to content
      </a>

      <Header {...props} />

      <main
        id="mu-main-content"
        className="flex-1 mx-auto w-full max-w-[var(--mu-container-page)] px-[var(--mu-gutter)] py-8 lg:py-12"
      >
        {children}
      </main>

      <Footer {...props} />
    </div>
  );
}

export const MustafaLayout = Layout;
export default Layout;
