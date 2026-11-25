import { STOREFRONT_THEME_CONFIG_DEFAULTS, storefrontThemeConfigOf, themeStyleVars, type StorefrontThemeConfig } from "@markaz/storefront-data";
import type { AnnouncementData } from "../types/components/navbar/AnnouncementBar";
import type { HeroProps } from "../types/components/hero/Hero";

/**
 * Sprint 7 (S7-B7): how Stiletto applies a store's theme config (store.storefront.themeConfig, validated and defaulted by the backend and validated AGAIN here).
 * Pure, so a check file covers it. Three rules keep a seller's input out of markup and CSS:
 *   - colours and the font reach the page only as CSS custom properties built by themeStyleVars from VALIDATED values (a normalised hex, a font NAME mapped to a fixed
 *     stack); a style attribute is never concatenated from a string;
 *   - every text (hero title, subtitle, button, announcement) is returned as a plain string for a React text node (the hero has a separate `titleText` prop that is
 *     rendered as text, never through dangerouslySetInnerHTML, which stays only for the theme's own built-in title);
 *   - a link is an internal path or an https address (the schema), and the hero picture is a URL the backend read from the seller's own media.
 */

export interface StilettoSections {
  featured: boolean;
  categories: boolean;
  reviews: boolean;
  blog: boolean;
}

export interface StilettoThemeView {
  config: StorefrontThemeConfig;
  /** CSS custom properties for a style prop: built from validated values only. Empty when the config changes no colour or font. */
  style: Record<string, string>;
  sections: StilettoSections;
}

/** The whole view of a store's config: validated again, defaults filled in, the style object built. */
export function stilettoThemeView(store: { themeConfig?: unknown } | null | undefined): StilettoThemeView {
  const config = storefrontThemeConfigOf(store);
  // Only what DIFFERS from the defaults becomes a CSS variable, so a store that never changed a colour (or a theme demo) is styled exactly as before.
  const changed = (key: "primaryColor" | "accentColor" | "fontFamily") => (config[key] !== STOREFRONT_THEME_CONFIG_DEFAULTS[key] ? config[key] : undefined);
  return {
    config,
    style: themeStyleVars({ primaryColor: changed("primaryColor"), accentColor: changed("accentColor"), fontFamily: changed("fontFamily") }),
    sections: { featured: config.showFeatured, categories: config.showCategories, reviews: config.showReviews, blog: config.showBlog },
  };
}

/**
 * The hero with the seller's words over the theme's own. A seller's title goes to `titleText` (rendered as text); the theme's own title (which holds a line
 * break) stays in `title`. A seller's picture replaces the background video. The button and its link change only when set.
 */
export function applyHeroConfig(hero: HeroProps, config: StorefrontThemeConfig): HeroProps {
  return {
    ...hero,
    ...(config.heroTitle ? { titleText: config.heroTitle } : {}),
    ...(config.heroSubtitle ? { subHeading: config.heroSubtitle } : {}),
    ...(config.heroImageUrl ? { imageSrc: config.heroImageUrl } : {}),
    ...(config.heroCtaLabel ? { buttonText: config.heroCtaLabel } : {}),
    ...(config.heroCtaLink ? { buttonLink: config.heroCtaLink } : {}),
  };
}

/** The announcement bar: off with the switch, the seller's text when set, else what the store already showed. */
export function applyAnnouncementConfig(base: AnnouncementData, config: StorefrontThemeConfig): AnnouncementData {
  if (!config.announcementEnabled) return { messages: [], showArrows: false };
  if (config.announcementText) return { messages: [config.announcementText], showArrows: false };
  return base;
}

/** The footer links of the store's content: the Blog link goes when the seller switched the blog off. Pages stay. */
export function applyStoreLinks<T extends { href: string }>(links: readonly T[], config: StorefrontThemeConfig): T[] {
  return config.showBlog ? [...links] : links.filter((link) => link.href !== "/blog" && !link.href.startsWith("/blog/"));
}
