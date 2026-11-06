import type { NormalizedCategory } from "../model";
import { paths } from "../adapters/paths";

/** A static collection used only by the default navigation config. Live and demo headers are built from real categories. */
export const fallbackCollections: NormalizedCategory[] = [
  {
    id: "static-bra-panty-sets",
    title: "Bra & Panty Sets",
    handle: "bra-panty-sets",
    image: "https://images.unsplash.com/photo-1568663521381-33b7c467fda0?w=600&auto=format&fit=crop&q=60",
    href: paths.collection("bra-panty-sets"),
    descriptionHtml:
      "<p>Discover our premium matching bra and panty sets crafted with ultra-soft, breathable fabrics. Designed for everyday comfort and elegant all-day support.</p>",
    plainTextDescription:
      "Discover our premium matching bra and panty sets crafted with ultra-soft, breathable fabrics. Designed for everyday comfort and elegant all-day support.",
    videoUrl: "",
  },
];
