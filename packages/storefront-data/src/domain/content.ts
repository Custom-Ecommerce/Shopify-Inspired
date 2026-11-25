import type { ContentTree } from "@markaz/platform-kit/content-markdown";
import type { StorefrontArticle, StorefrontArticleSummary, StorefrontPage, StorefrontPageLink } from "../transport/content-types";
import { storePaths } from "../view-models/paths";

/**
 * Sprint 7 (S7-B3): the view-models of the blog and the static pages, the footer links built from them, the sitemap and the canonical address. Pure: the
 * storefront has no unit test runner, so every rule is here and checked by test/blog-pages.check.ts.
 */

export interface ArticleCardVM {
  id: string;
  slug: string;
  href: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  tags: string[];
  /** For example "14 Nov 2026". Computed in UTC, so the server and the browser print the same text. */
  dateLabel: string | null;
  /** ISO date-time, for a <time dateTime>. */
  dateIso: string | null;
}

export interface ArticleVM extends ArticleCardVM {
  content: ContentTree;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface ContentPageVM {
  slug: string;
  title: string;
  content: ContentTree;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "14 Nov 2026" in UTC, or null for anything that is not a date. */
export function formatPublishedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCDate() + " " + MONTHS[date.getUTCMonth()] + " " + date.getUTCFullYear();
}

export function toArticleCardVM(article: StorefrontArticleSummary): ArticleCardVM {
  return {
    id: article.id,
    slug: article.slug,
    href: storePaths.article(article.slug),
    title: article.title,
    excerpt: article.excerpt,
    coverUrl: article.coverImageUrl,
    tags: article.tags,
    dateLabel: formatPublishedDate(article.publishedAt),
    dateIso: article.publishedAt,
  };
}

export function toArticleVM(article: StorefrontArticle): ArticleVM {
  return { ...toArticleCardVM(article), content: article.content, seoTitle: article.seoTitle, seoDescription: article.seoDescription };
}

export function toContentPageVM(page: StorefrontPage): ContentPageVM {
  return { slug: page.slug, title: page.title, content: page.content };
}

export interface FooterLink {
  label: string;
  href: string;
}

/**
 * The footer links the content adds: the published pages the seller chose to show in the footer (in their order), then the Blog when the store has at
 * least one published article. A store with neither adds nothing.
 */
export function contentFooterLinks(pages: StorefrontPageLink[], hasArticles: boolean): FooterLink[] {
  const links = pages
    .filter((page) => page.showInFooter)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    .map((page) => ({ label: page.title, href: storePaths.page(page.slug) }));
  if (hasArticles) links.push({ label: "Blog", href: storePaths.blog });
  return links;
}

/** The first sentence-ish text for a description tag: the excerpt, else the SEO description, cut at 160 characters. */
export function articleDescription(article: Pick<StorefrontArticle, "excerpt" | "seoDescription">): string | null {
  const text = (article.seoDescription ?? article.excerpt ?? "").trim();
  if (text === "") return null;
  return text.length <= 160 ? text : text.slice(0, 157).trimEnd() + "...";
}

/** The title of an article's tab: the SEO title when the seller wrote one, else the article's title. */
export function articleTitle(article: Pick<StorefrontArticle, "title" | "seoTitle">): string {
  return article.seoTitle && article.seoTitle.trim() !== "" ? article.seoTitle.trim() : article.title;
}

// ------------------------------------------------------------------------------------------------------------------------- canonical and sitemap

/** The store's origin from a request: http or https and a host, no path. Null for anything else (so no bad address is ever printed). */
export function cleanOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "" || url.username !== "" || url.password !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The canonical address of a store path: the origin plus the path. Null when the origin is not usable. */
export function canonicalUrl(origin: string | null | undefined, path: string): string | null {
  const base = cleanOrigin(origin);
  if (base === null) return null;
  return base + (path.startsWith("/") ? path : "/" + path);
}

/** Escapes text for XML (the sitemap). */
export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export interface SitemapInput {
  origin: string | null | undefined;
  /** Published articles: the slug and the publish date. */
  articles: Array<{ slug: string; publishedAt: string | null }>;
  /** Published pages: the slug and the last change. */
  pages: Array<{ slug: string; updatedAt: string | null }>;
}

const lastmod = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : "<lastmod>" + date.toISOString() + "</lastmod>";
};

/**
 * The sitemap of one store: the home page, the catalogue, the blog (when it has an article), each published article and each published page. A draft is
 * never in it, because the inputs are the public lists. Every address is the canonical one and every value is escaped. Null when the origin is not usable.
 */
export function buildStoreSitemapXml(input: SitemapInput): string | null {
  const base = cleanOrigin(input.origin);
  if (base === null) return null;
  const entries: Array<{ path: string; modified: string }> = [
    { path: "/", modified: "" },
    { path: storePaths.catalog, modified: "" },
  ];
  if (input.articles.length > 0) entries.push({ path: storePaths.blog, modified: lastmod(input.articles[0]!.publishedAt) });
  for (const article of input.articles) entries.push({ path: storePaths.article(article.slug), modified: lastmod(article.publishedAt) });
  for (const page of input.pages) entries.push({ path: storePaths.page(page.slug), modified: lastmod(page.updatedAt) });
  const urls = entries.map((entry) => "<url><loc>" + escapeXml(base + entry.path) + "</loc>" + entry.modified + "</url>");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join("\n") + "\n</urlset>\n";
}

/** The robots.txt of a store: open and pointing at its sitemap when live, closed otherwise (a preview or a store that is not serving). */
export function buildStoreRobotsTxt(options: { origin: string | null | undefined; live: boolean }): string {
  if (!options.live) return "User-agent: *\nDisallow: /\n";
  const sitemap = canonicalUrl(options.origin, "/sitemap.xml");
  return "User-agent: *\nAllow: /\n" + (sitemap === null ? "" : "Sitemap: " + sitemap + "\n");
}
