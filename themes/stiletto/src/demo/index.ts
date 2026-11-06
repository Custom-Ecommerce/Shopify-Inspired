import type { ThemeDemo } from "@markaz/storefront-theme-kit";
import { stilettoFixtures } from "./fixtures";

/** What theme.stiletto.localhost shows: the fixtures above, no seller backend, no banner bar (a small pill instead). */
export const demo: ThemeDemo = {
  fixtures: stilettoFixtures,
  store: { name: "Stiletto", logoUrl: null, announcement: null, currency: "PKR", locale: "en-PK" },
  nav: { links: [] },
  footer: { links: [], copyright: "Stiletto theme demo" },
  banner: "overlay",
};
