"use client";

import type { HomePageProps as ContractHomePageProps } from "@markaz/storefront-data";
import { HomePage as HomeSections } from "../sections/HomePage";
import { useStilettoChrome } from "../adapters/chrome-context";
import { useStoreData } from "../shared/context/StoreDataContext";

/**
 * The home composition. `featured` (rating-ordered) is not used by the original layout, which groups the whole
 * catalogue by category, so the products come from the store chrome.
 */
export function HomePage(_props: ContractHomePageProps) {
  const { content } = useStilettoChrome();
  const { categories, products } = useStoreData();
  return (
    <HomeSections
      categories={categories}
      products={products}
      navConfig={content.navConfig}
      homeConfig={content.homeConfig}
      testimonials={content.testimonials}
      featuresConfig={content.featuresConfig}
      footerConfig={content.footerConfig}
      promoBanner={content.promoBanner}
      productShowcase={content.productShowcase}
    />
  );
}
