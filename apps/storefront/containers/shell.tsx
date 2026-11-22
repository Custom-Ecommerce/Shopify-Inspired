import type { ReactNode } from "react";
import type { ThemeModule } from "@markaz/storefront-theme-kit";
import { storePaths } from "@markaz/storefront-data";
import type { FooterLink, FooterVM, NavVM, StoreChromeVM, StoreVM } from "@markaz/storefront-data";
import type { TenantSnapshot } from "@/context/tenant-context";

/**
 * The store shell: the theme's Layout, filled in from the tenant snapshot. Its header holds client components that read
 * the cart, so this must render inside the StorefrontProvider. Themes never read the snapshot; they get these view-models.
 */
export function StoreShell({
  snapshot,
  theme,
  chrome,
  contentLinks = [],
  children,
}: {
  snapshot: TenantSnapshot;
  theme: ThemeModule;
  chrome?: StoreChromeVM;
  /** Sprint 7 (S7-B3): the footer links the store's pages and blog add. */
  contentLinks?: FooterLink[];
  children: ReactNode;
}) {
  const Layout = theme.Layout;
  const store: StoreVM = {
    name: snapshot.storeName,
    logoUrl: snapshot.branding.logoUrl ?? null,
    announcement: snapshot.branding.announcementText ?? null,
    currency: snapshot.commerce.currency,
    locale: snapshot.commerce.locale,
    description: snapshot.profile?.description ?? null,
    bannerUrl: snapshot.branding.bannerUrl ?? null,
    contact: {
      phone: snapshot.profile?.contactPhone ?? null,
      whatsapp: snapshot.commerce.whatsappNumber ?? null,
      email: snapshot.profile?.contactEmail ?? null,
      address: snapshot.profile?.address ?? null,
      city: snapshot.profile?.city ?? null,
    },
    social: snapshot.social ?? null,
    deliveryEstimate: snapshot.commerce.deliveryEstimate ?? null,
  };
  const nav: NavVM = {
    links: [
      { label: "Products", href: storePaths.catalog },
      { label: "Track order", href: storePaths.track() },
    ],
  };
  const footer: FooterVM = {
    links: [
      { label: "Track order", href: storePaths.track() },
      { label: "Cart", href: storePaths.cart },
      ...contentLinks,
    ],
    copyright: "© " + new Date().getFullYear() + " " + snapshot.storeName,
  };

  return (
    <Layout store={store} nav={nav} footer={footer} chrome={chrome} mode="live" lang="en" dir="ltr">
      {children}
    </Layout>
  );
}
