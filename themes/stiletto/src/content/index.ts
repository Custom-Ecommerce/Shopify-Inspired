import type { AnnouncementData, CartDrawerData, FooterConfig, HeroProps, NavItem, PhilosophyProps, PromoBannerProps, SearchDrawerData, TestimonialsProps, VideoStoryProps, FeatureItem, ProductShowcaseBanner } from "../types";
import type { NormalizedCategory, ReviewItem, StoreData } from "../model";
import { paths } from "../adapters/paths";
import { STILETTO_LOGO, STILETTO_LOGO_LIGHT } from "../adapters/images";
import { homeConfig } from "./home.config";
import { featuresConfig } from "./features.config";
import { testimonials } from "./testimonials.config";
import { footerConfig } from "./footer.config";
import { navConfig } from "./nav.config";
import { shippingDetails } from "./product.config";
import { promoBanner } from "./promo-banner.config";
import { productShowcase } from "./product-showcase.config";
import { feedbackImages, sampleReviews } from "./reviews";

export interface StilettoContent {
  brandName: string;
  navConfig: {
    announcement: AnnouncementData;
    brand: { name: string; href: string; logo?: string };
    menuLogo?: string;
    navLinks: NavItem[];
    searchDrawer: SearchDrawerData;
    cartDrawer: CartDrawerData;
  };
  homeConfig: { hero: HeroProps; marquee: string[]; philosophy: PhilosophyProps; videoStory: VideoStoryProps };
  testimonials: TestimonialsProps;
  featuresConfig: FeatureItem[];
  footerConfig: FooterConfig;
  promoBanner: PromoBannerProps;
  productShowcase: { banner: ProductShowcaseBanner };
  shippingDetails: string[];
  sampleReviews: ReviewItem[];
  feedbackImages: string[];
}

/**
 * The theme's static defaults with the store's own facts laid over them: name, logo, announcement, and navigation built
 * from the store's real categories. Hero, marquee, philosophy, video story, testimonials and features are not editable
 * by sellers yet, so they are the theme's defaults for every store.
 */
export function buildStilettoContent(store: StoreData, categories: NormalizedCategory[]): StilettoContent {
  const demo = store.mode === "demo";
  const logo = store.logoUrl ?? STILETTO_LOGO;
  const menuLogo = store.logoUrl ?? STILETTO_LOGO_LIGHT;
  const announcement: AnnouncementData = demo && !store.announcement
    ? navConfig.announcement
    : { messages: [store.announcement ?? "Welcome to " + store.name], showArrows: false };
  const footerBrand = { ...footerConfig.brand, name: store.name, logo: menuLogo };
  return {
    brandName: store.name,
    navConfig: {
      announcement,
      brand: { name: store.name, href: paths.home, logo },
      menuLogo,
      navLinks: categories.map((c) => ({ label: c.title, href: c.href, hasMegaMenu: true, image: c.image })),
      searchDrawer: { popularCollections: categories.map((c) => c.title) },
      cartDrawer: { emptyStateLinks: categories.map((c) => ({ label: "SHOP " + c.title.toUpperCase(), href: c.href })) },
    },
    homeConfig: {
      ...homeConfig,
      hero: { ...homeConfig.hero, secondaryButtonLink: categories[0]?.href ?? paths.collections },
    },
    testimonials,
    featuresConfig,
    footerConfig: { ...footerConfig, brand: footerBrand },
    promoBanner,
    productShowcase: { banner: productShowcase.banner },
    shippingDetails,
    // Sample reviews are the theme's demo data. The platform has no review list yet, so a live store shows none.
    sampleReviews: demo ? sampleReviews : [],
    feedbackImages,
  };
}
