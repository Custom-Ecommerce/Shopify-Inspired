import type { NormalizedCategory, NormalizedProduct } from "../model";
import type { HeroProps } from "../types/components/hero/Hero";
import type { AnnouncementData } from "../types/components/navbar/AnnouncementBar";
import type { SearchDrawerData } from "../types/components/navbar/SearchDrawer";
import type { CartDrawerData } from "../types/components/navbar/CartDrawer";
import type { NavItem } from "../types/components/navbar/NavItem";
import type { PhilosophyProps } from "../types/components/misc/Philosophy";
import type { VideoStoryProps } from "../types/components/misc/VideoStory";
import type { TestimonialsProps } from "../types/components/misc/Testimonials";
import type { FeatureItem } from "../types/components/misc/Features";
import type { FooterConfig } from "../types/components/footer/Footer";
import type { PromoBannerProps } from "../types/components/promo-banner/PromoBanner";
import type { ProductShowcaseBanner } from "../types/components/showcase/ProductShowcase";
import {
  CategoryCarousel,
  FeaturedEdit,
  Header,
  Hero,
  Marquee,
  Philosophy,
  ProductShowcase,
  PromoBanner,
  Testimonials,
  VideoStory,
  Features,
  Footer,
} from "../components";
import { productMatchesCategory } from "../shared/lib/productCategoryMatch";
import { paths } from "../adapters/paths";

// ============================================================================
// HomePage — Stiletto theme's home page composition.
// ----------------------------------------------------------------------------
// Extracted from `apps/store-undergarments/app/page.tsx` (Phase 6). This is
// the theme's opinion of how its own components are laid out and sequenced
// for the storefront homepage; the *data* powering it is still 100% owned by
// the consuming app (fetched server-side, passed in as props). Keeping data
// fetching in the app and composition in the theme is what lets a second
// theme implement its own `HomePage` with a totally different layout while
// reusing the exact same app-level data contract.
// ============================================================================

export interface HomePageProps {
  categories: NormalizedCategory[];
  products: NormalizedProduct[];
  navConfig: {
    announcement?: AnnouncementData;
    brand: { name: string; href: string; logo?: string };
    menuLogo?: string;
    navLinks: NavItem[];
    searchDrawer?: SearchDrawerData;
    cartDrawer?: CartDrawerData;
  };
  homeConfig: {
    hero: HeroProps;
    marquee: string[];
    philosophy: PhilosophyProps;
    videoStory: VideoStoryProps;
  };
  testimonials: TestimonialsProps;
  featuresConfig: FeatureItem[];
  footerConfig: FooterConfig;
  promoBanner: PromoBannerProps;
  productShowcase: {
    banner: ProductShowcaseBanner;
  };
}

export function HomePage({
  categories,
  products,
  navConfig,
  homeConfig,
  testimonials,
  featuresConfig,
  footerConfig,
  promoBanner,
  productShowcase,
}: HomePageProps) {
  const { hero, marquee, philosophy, videoStory } = homeConfig;

  return (
    <div className="min-h-screen bg-[var(--brand-background)]">
      <Header
        announcement={navConfig.announcement}
        brand={navConfig.brand}
        navLinks={navConfig.navLinks}
        categories={categories}
        searchDrawerData={navConfig.searchDrawer}
        cartDrawerData={navConfig.cartDrawer}
        menuLogo={navConfig.menuLogo}
      />

      <main className="relative w-full">
        <Hero {...hero} />
        <Marquee messages={marquee} />
        <Philosophy {...philosophy} />

        <div className="w-full h-4 md:h-5 bg-[var(--separator-bg)] border-t border-[var(--separator-border)]" />

        <CategoryCarousel title="Shop by Category" items={categories} />

        {/* <div className="w-full h-4 md:h-5 bg-[var(--separator-bg)] border-t border-[var(--separator-border)]" />
        <PromoBanner {...promoBanner} />
        <div className="w-full h-4 md:h-5 bg-[var(--separator-bg)] border-t border-[var(--separator-border)]" /> */}

        <ProductShowcase banner={productShowcase.banner} products={products} />

        <div className="w-full h-4 md:h-5 bg-[var(--separator-bg)] border-t border-[var(--separator-border)]" />

        <FeaturedEdit
          title="Featured Products"
          buttonText="View All"
          buttonLink={paths.catalog}
          tabs={categories.map((cat) => ({
            label: cat.title,
            products: products.filter((p) => productMatchesCategory(p, cat)),
          }))}
        />

        <div className="w-full h-4 md:h-5 bg-[var(--separator-bg)] border-t border-[var(--separator-border)]" />

        <Testimonials {...testimonials} />
        <VideoStory {...videoStory} />
        <Features data={featuresConfig} />
        <Footer config={footerConfig} />
      </main>
    </div>
  );
}
