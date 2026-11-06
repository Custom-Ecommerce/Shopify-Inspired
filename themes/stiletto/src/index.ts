import "./styles/stiletto.css";
import { defineTheme, defineThemeManifest, THEME_CONTRACT_VERSION } from "@markaz/storefront-theme-kit";
import { Layout } from "./layout/layout";
import { HomePage } from "./pages/home-page";
import { CatalogPage } from "./pages/catalog-page";
import { ProductPage } from "./pages/product-page";
import { SearchPage } from "./pages/search-page";
import { CartPage } from "./pages/cart-page";
import { CheckoutPage } from "./pages/checkout-page";
import { OrderConfirmationPage } from "./pages/order-confirmation-page";
import { OrderTrackingPage } from "./pages/order-tracking-page";
import { ContentPage } from "./pages/content-page";
import { NotFoundPage } from "./pages/not-found-page";
import { UnavailablePage } from "./pages/unavailable-page";
import { CollectionsPage } from "./pages/collections-page";
import { CollectionPage } from "./pages/collection-page";
import { FeedbackPage } from "./pages/feedback-page";
import { demo } from "./demo";

export const manifest = defineThemeManifest({
  slug: "stiletto",
  version: "0.1.0",
  contractVersion: THEME_CONTRACT_VERSION,
});

const theme = defineTheme({
  manifest,
  Layout,
  pages: {
    Home: HomePage,
    Catalog: CatalogPage,
    Product: ProductPage,
    Search: SearchPage,
    Cart: CartPage,
    Checkout: CheckoutPage,
    OrderConfirmation: OrderConfirmationPage,
    OrderTracking: OrderTrackingPage,
    Content: ContentPage,
    NotFound: NotFoundPage,
    Unavailable: UnavailablePage,
    Collections: CollectionsPage,
    Collection: CollectionPage,
    Feedback: FeedbackPage,
  },
  wantsChrome: true,
  demo,
});

export default theme;

export { Layout };
export {
  CatalogPage,
  ProductPage,
  SearchPage,
  CartPage,
  CheckoutPage,
  OrderConfirmationPage,
  OrderTrackingPage,
  NotFoundPage,
  UnavailablePage,
  CollectionsPage,
  CollectionPage,
  FeedbackPage,
};
