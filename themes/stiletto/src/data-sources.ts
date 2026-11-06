/** Single source of truth for the section badges. The same table wrote the data-source attributes into the components. */
export type DataSourceBadge = "dynamic" | "static" | "partial";

export interface SectionSource {
  id: string;
  file: string;
  badge: DataSourceBadge;
  note: string;
}

export const SECTION_SOURCES: SectionSource[] = [
  { id: "announcement-bar", file: "components/header/AnnouncementBar.tsx", badge: "partial", note: "Message comes from the store's announcement text when set; otherwise theme text." },
  { id: "header", file: "components/header/Header.tsx", badge: "partial", note: "Logo and navigation come from the store's name, logo and categories; icons and layout are theme design." },
  { id: "mobile-menu", file: "components/header/MobileMenuSheet.tsx", badge: "partial", note: "Menu entries come from the store's categories; the rest is theme text." },
  { id: "search-drawer", file: "components/header/SearchDrawer.tsx", badge: "partial", note: "Popular collections come from the store's categories. The search box does not search in the source design." },
  { id: "cart-drawer", file: "components/header/CartDrawer.tsx", badge: "dynamic", note: "Cart lines and subtotal come from the customer's cart; suggestions from the store's products." },
  { id: "watermark", file: "shared/components/watermark/WatermarkBackground.tsx", badge: "partial", note: "The store's logo when it has one; otherwise the theme logo." },
  { id: "hero", file: "components/hero/Hero.tsx", badge: "static", note: "Hero headline, imagery and buttons are theme content; sellers cannot edit them yet." },
  { id: "marquee", file: "components/misc/Marquee.tsx", badge: "static", note: "Scrolling text is theme content." },
  { id: "philosophy", file: "components/misc/Philosophy.tsx", badge: "static", note: "Brand story text is theme content." },
  { id: "category-carousel", file: "components/category/CategoryCarousel.tsx", badge: "dynamic", note: "Categories come from the store's products." },
  { id: "product-showcase", file: "components/showcase/ProductShowcase.tsx", badge: "partial", note: "Products are the store's; the banner panel is theme content." },
  { id: "featured-edit", file: "components/featured-edit/FeaturedEdit.tsx", badge: "dynamic", note: "Tabs and products come from the store's categories and products." },
  { id: "testimonials", file: "components/misc/Testimonials.tsx", badge: "static", note: "Testimonials are theme content; the platform has none yet." },
  { id: "video-story", file: "components/misc/VideoStory.tsx", badge: "static", note: "Video story is theme content." },
  { id: "features", file: "components/misc/Features.tsx", badge: "static", note: "Feature highlights are theme content." },
  { id: "promo-banner", file: "components/promo-banner/PromoBanner.tsx", badge: "static", note: "Promo banner and countdown are theme content." },
  { id: "footer", file: "components/footer/Footer.tsx", badge: "partial", note: "Brand name and logo come from the store; links, newsletter and copy are theme content." },
  { id: "collection-header", file: "components/collection/CollectionHeader.tsx", badge: "partial", note: "Title and item count come from the store's data; wording around them is theme text." },
  { id: "all-products", file: "components/all-products/CategoryProductSection.tsx", badge: "dynamic", note: "Category groups and products come from the store." },
  { id: "all-collections", file: "components/collection/AllCollectionsGrid.tsx", badge: "dynamic", note: "Collections come from the store's categories." },
  { id: "collection-grid", file: "components/collection/SingleCollectionProductGrid.tsx", badge: "dynamic", note: "Products of this category come from the store." },
  { id: "product-gallery", file: "components/product-detail/ProductGallery.tsx", badge: "dynamic", note: "Images come from the product." },
  { id: "product-info", file: "components/product-detail/ProductInfo.tsx", badge: "partial", note: "Title, price and stock are the product's. Sizes, colours and packs are not supported by the platform." },
  { id: "product-accordion", file: "components/product-detail/ProductAccordion.tsx", badge: "partial", note: "Description is the product's; shipping and care text is theme content." },
  { id: "product-reviews", file: "components/product-detail/ProductReviewsSection.tsx", badge: "static", note: "Sample reviews. The platform has no review list yet, so every store shows the same samples." },
  { id: "checkout", file: "components/checkout/checkout-section.tsx", badge: "partial", note: "Cart, delivery charges and totals are live. Email, billing address and notes are shown but not stored." },
];
