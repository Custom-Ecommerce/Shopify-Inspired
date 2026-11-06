import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

/** Canonical origin for marketing URLs. Used by metadataBase, sitemap and robots. */
export const SITE_URL = new URL(`https://${BRAND.domain}`);

export interface PageMetaInput {
  /** Page title. The root title template adds "| Markazify" automatically. */
  title: string;
  /** 120 to 160 characters, plain words, written for shop owners. */
  description: string;
  /** Route path such as "/features". Used for the canonical URL. */
  path: string;
}

/**
 * One helper for every marketing page so titles, descriptions, canonical URLs
 * and Open Graph tags follow the same rules. Pages must not hand-write these.
 */
export function buildPageMetadata({ title, description, path }: PageMetaInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} | ${BRAND.name}`,
      description,
      url: path,
      siteName: BRAND.name,
      type: "website",
      locale: "en_PK",
    },
  };
}
