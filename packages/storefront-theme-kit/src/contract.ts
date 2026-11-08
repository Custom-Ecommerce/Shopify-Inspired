import type { ComponentType, ReactNode } from "react";
import type * as VM from "@markaz/storefront-data";

export interface StoreLayoutProps {
  store: VM.StoreVM; nav: VM.NavVM; footer: VM.FooterVM;
  /** Categories and products, for themes that build navigation and search from the catalogue. Present when the theme asks for it. */
  chrome?: VM.StoreChromeVM;
  /** Whether the store is a live store or a theme demo. */
  mode?: "demo" | "live";
  lang: string; dir: "ltr" | "rtl"; children: ReactNode;
}

/** A theme's own demo: its catalogue and the store facts the demo host shows. */
export interface ThemeDemo {
  fixtures: VM.MockFixtures;
  store: VM.StoreVM;
  nav: VM.NavVM;
  footer: VM.FooterVM;
  /** `top` is a bar above the store; `overlay` is a small pill that does not move the layout. */
  banner?: "top" | "overlay";
}

export interface ThemeModule {
  manifest: { slug: string; version: string; contractVersion: 1 };
  Layout: ComponentType<StoreLayoutProps>;
  pages: {
    Home: ComponentType<VM.HomePageProps>;
    Catalog: ComponentType<VM.CatalogPageProps>;
    Product: ComponentType<VM.ProductPageProps>;
    Search: ComponentType<VM.SearchPageProps>;
    Cart: ComponentType<VM.CartPageProps>;
    Checkout: ComponentType<VM.CheckoutPageProps>;
    OrderConfirmation: ComponentType<VM.OrderConfirmationPageProps>;
    OrderTracking: ComponentType<VM.OrderTrackingPageProps>;
    Content: ComponentType<VM.ContentPageProps>;
    NotFound: ComponentType<VM.NotFoundPageProps>;
    Unavailable: ComponentType<VM.UnavailablePageProps>;
    Collections?: ComponentType<VM.CollectionsPageProps>;
    Collection?: ComponentType<VM.CollectionPageProps>;
    Feedback?: ComponentType<VM.FeedbackPageProps>;
    Favourites?: ComponentType<VM.FavouritesPageProps>;
  };
  /** Set to have the container load the store's catalogue once and pass it to Layout as `chrome`. */
  wantsChrome?: boolean;
  demo?: ThemeDemo;
}
/* @theme-integration-patch:contract */
