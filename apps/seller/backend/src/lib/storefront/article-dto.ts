import * as markdownNs from '@markaz/platform-kit/content-markdown';
import { unwrapCjs } from '@/lib/cjs';
import { articleContentText } from '@/lib/articles';

const markdown: typeof markdownNs = unwrapCjs(markdownNs);

/**
 * Sprint 7 (S7-B2): what a shopper may read of an article. The storefront route comes in S7-B3 and must build every answer here, so the one rule
 * "a draft never leaves the seller's dashboard" lives in ONE place:
 *   - the filter a public query must use (published blog articles of the store, nothing else), and
 *   - the DTO builder, which answers null for any article that is not published (a second guard if a wrong query ever returned one).
 * The DTO carries the content as the SAFE TREE (never the stored text, never HTML) and leaves out everything private: the status, the revision, the media
 * references, the store id and the tags' order of writing.
 */

/** The filter for a public article query of one store. Never widen it. */
export function publicArticleFilter(storeId: string): { store: string; status: 'published'; type: 'blog' } {
  return { store: storeId, status: 'published', type: 'blog' };
}

export interface StoredArticleRow {
  _id: unknown;
  title?: unknown;
  slug?: unknown;
  excerpt?: unknown;
  content?: unknown;
  status?: unknown;
  type?: unknown;
  tags?: unknown;
  seoTitle?: unknown;
  seoDescription?: unknown;
  publishedAt?: unknown;
}

export interface StorefrontArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  /** The safe tree of the content (see @markaz/platform-kit/content-markdown). */
  content: markdownNs.ContentTree;
  coverImageUrl: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

/** Whether a stored article may be shown to shoppers. */
export function isPublicArticle(row: Pick<StoredArticleRow, 'status' | 'type'>): boolean {
  return row.status === 'published' && (row.type === undefined || row.type === 'blog');
}

/** The shopper's view of an article, or null when it is not public (a draft, an archived one, another type). `coverImageUrl` is resolved by the caller from the store's media. */
export function toStorefrontArticle(row: StoredArticleRow, options: { coverImageUrl?: string | null } = {}): StorefrontArticle | null {
  if (!isPublicArticle(row)) return null;
  const title = text(row.title);
  const slug = text(row.slug);
  if (title === null || slug === null) return null;
  const cover = options.coverImageUrl ?? null;
  return {
    id: String(row._id),
    title,
    slug,
    excerpt: text(row.excerpt),
    content: markdown.parseContent(articleContentText(row.content)),
    coverImageUrl: cover !== null && markdown.safeUrl(cover, 'image') !== null ? cover : null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    seoTitle: text(row.seoTitle),
    seoDescription: text(row.seoDescription),
    publishedAt: iso(row.publishedAt),
  };
}
