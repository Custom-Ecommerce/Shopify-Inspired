import { paths } from "../adapters/paths";
import { fallbackCollections } from "./collections.data";

export const navConfig = {
  announcement: {
    messages: [
      "Free shipping on orders over Rs. 2500",
      "Welcome to Standard Undergarments",
      "10% off your first order",
    ],
    showArrows: true,
  },
  brand: { name: "STILETTO", href: paths.home, logo: "/theme-assets/stiletto/logo/logo.png" },
  menuLogo: "/theme-assets/stiletto/logo/logo-light.jpeg",
  navLinks: fallbackCollections.map((collection) => ({
    label: collection.title,
    href: collection.href,
    hasMegaMenu: true,
    image: collection.image,
  })),
  searchDrawer: {
    popularCollections: fallbackCollections.map((c) => c.title),
  },
  cartDrawer: {
    emptyStateLinks: fallbackCollections.map((collection) => ({
      label: `SHOP ${collection.title.toUpperCase()}`,
      href: collection.href,
    })),
  },
};
