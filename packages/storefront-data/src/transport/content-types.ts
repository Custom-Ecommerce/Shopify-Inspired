import type { ContentTree } from "@markaz/platform-kit/content-markdown";

/**
 * Sprint 7 (S7-B3): the blog and the static pages as the storefront receives them. Mirror the seller backend's public routes
 * (apps/seller/backend lib/storefront/content-dto.ts). The text is ALWAYS the safe tree of @markaz/platform-kit/content-markdown: never stored text, never
 * HTML. Nothing private is in these types (no status, revision, media references, store id).
 */

/** One line of the blog list. */
export interface StorefrontArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: string[];
  /** ISO date-time of the first publish. */
  publishedAt: string | null;
}

export interface StorefrontArticle extends StorefrontArticleSummary {
  content: ContentTree;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface StorefrontArticleList {
  items: StorefrontArticleSummary[];
  page: number;
  totalPages: number;
  totalDocs: number;
}

/** A published page in the footer and the sitemap: its address and title, never its text. */
export interface StorefrontPageLink {
  slug: string;
  title: string;
  showInFooter: boolean;
  sortOrder: number;
  updatedAt: string | null;
}

export interface StorefrontPage {
  slug: string;
  title: string;
  content: ContentTree;
  publishedAt: string | null;
  updatedAt: string | null;
}

/**
 * What the store has at a page address. `draft` is a page the seller has not published: the storefront answers 404 and does NOT show its default copy.
 * `none` is an address the store has no page for: the default copy (about, contact) may be shown.
 */
export type StorefrontPageLookup = { kind: "found"; page: StorefrontPage } | { kind: "draft" } | { kind: "none" };
