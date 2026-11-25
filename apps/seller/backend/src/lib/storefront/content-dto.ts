import * as markdownNs from '@markaz/platform-kit/content-markdown';
import { unwrapCjs } from '@/lib/cjs';
import { isPublicArticle, type StoredArticleRow } from '@/lib/storefront/article-dto';

const markdown: typeof markdownNs = unwrapCjs(markdownNs);

/**
 * Sprint 7 (S7-B3): what the public blog and page routes send. Every answer is built here, so the rules sit in one place:
 *   - an article is public only when it is a published blog article (lib/storefront/article-dto.ts), a page only when it is published;
 *   - the text always goes out as the SAFE TREE of @markaz/platform-kit/content-markdown, never as stored text and never as HTML;
 *   - nothing private goes out: no status, revision, media references, store id or template.
 */

/** The filter of a public page query of one store. Never widen it: a draft page is not public. */
export function publicPageFilter(storeId: string): { store: string; status: 'published' } {
  return { store: storeId, status: 'published' };
}

export interface StoredPageRow {
  _id: unknown;
  title?: unknown;
  slug?: unknown;
  body?: unknown;
  status?: unknown;
  showInFooter?: unknown;
  sortOrder?: unknown;
  publishedAt?: unknown;
  updatedAt?: unknown;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

export interface StorefrontArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: string[];
  publishedAt: string | null;
}

/** One line of the blog list, or null when the article is not public. `coverImageUrl` is resolved by the caller from the store's media. */
export function toStorefrontArticleSummary(row: StoredArticleRow, options: { coverImageUrl?: string | null } = {}): StorefrontArticleSummary | null {
  if (!isPublicArticle(row)) return null;
  const title = text(row.title);
  const slug = text(row.slug);
  if (title === null || slug === null) return null;
  const cover = options.coverImageUrl ?? null;
  return {
    id: String(row._id),
    slug,
    title,
    excerpt: text(row.excerpt),
    coverImageUrl: cover !== null && markdown.safeUrl(cover, 'image') !== null ? cover : null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    publishedAt: iso(row.publishedAt),
  };
}

export interface StorefrontPage {
  slug: string;
  title: string;
  /** The safe tree of the body. */
  content: markdownNs.ContentTree;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface StorefrontPageLink {
  slug: string;
  title: string;
  showInFooter: boolean;
  sortOrder: number;
  updatedAt: string | null;
}

/** Whether a stored page may be shown to shoppers. */
export function isPublicPage(row: Pick<StoredPageRow, 'status'>): boolean {
  return row.status === 'published';
}

/** The shopper's view of a page, or null when it is not published (a draft). */
export function toStorefrontPage(row: StoredPageRow): StorefrontPage | null {
  if (!isPublicPage(row)) return null;
  const title = text(row.title);
  const slug = text(row.slug);
  if (title === null || slug === null) return null;
  return { slug, title, content: markdown.parseContent(typeof row.body === 'string' ? row.body : ''), publishedAt: iso(row.publishedAt), updatedAt: iso(row.updatedAt) };
}

/** One entry of the footer and the sitemap, or null when the page is not published. */
export function toStorefrontPageLink(row: StoredPageRow): StorefrontPageLink | null {
  if (!isPublicPage(row)) return null;
  const title = text(row.title);
  const slug = text(row.slug);
  if (title === null || slug === null) return null;
  return { slug, title, showInFooter: row.showInFooter === true, sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : 0, updatedAt: iso(row.updatedAt) };
}
