"use client";

import type { CheckoutPageProps } from "@markaz/storefront-data";
import { CheckoutSection } from "../components/checkout/checkout-section";
import { useStilettoChrome } from "../adapters/chrome-context";

export function CheckoutPage(_props: CheckoutPageProps) {
  const { content } = useStilettoChrome();
  return (
    <div className="min-h-screen bg-[var(--nav-mobile-bg,#000)]">
      <main className="relative">
        <CheckoutSection logoSrc={content.navConfig.menuLogo} />
      </main>
    </div>
  );
}
