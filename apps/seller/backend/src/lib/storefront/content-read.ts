import { Media, StoreArticle, StorePage } from '@/lib/services';
import { publicArticleFilter, toStorefrontArticle, type StoredArticleRow, type StorefrontArticle } from '@/lib/storefront/article-dto';
import {
  publicPageFilter,
  toStorefrontArticleSummary,
  toStorefrontPage,
  toStorefrontPageLink,
  type StoredPageRow,
  type StorefrontArticleSummary,
  type StorefrontPage,
  type StorefrontPageLink,
} from '@/lib/storefront/content-dto';

/**
 * Sprint 7 (S7-B3): the reads behind the public blog and page routes. Every query starts from publicArticleFilter or publicPageFilter (published only,
 * one store), and every row goes through a DTO builder that answers null for anything not public, so a draft cannot leave by a wrong query alone.
 */

export const ARTICLE_LIST_DEFAULT_LIMIT = 12;
export const ARTICLE_LIST_MAX_LIMIT = 50;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A slug in a URL: anything that is not a plain slug is simply "not found" and never reaches the database. */
export const isPlainSlug = (value: string): boolean => value.length > 0 && value.length <= 200 && SLUG.test(value);

async function coverUrls(storeId: string, rows: StoredArticleRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => (row as { coverImage?: unknown }).coverImage).filter((id) => id !== null && id !== undefined).map(String))];
  const urls = new Map<string, string>();
  if (ids.length === 0) return urls;
  const media = (await Media.find({ _id: { $in: ids }, store: storeId }).select('url').lean()) as unknown as Array<{ _id: unknown; url?: unknown }>;
  for (const row of media) if (typeof row.url === 'string') urls.set(String(row._id), row.url);
  return urls;
}

export interface ArticleListPage {
  data: StorefrontArticleSummary[];
  page: number;
  totalPages: number;
  totalDocs: number;
}

/** The published blog articles of a store, newest first. */
export async function listPublishedArticles(storeId: string, page: number, limit: number): Promise<ArticleListPage> {
  const filter = publicArticleFilter(storeId);
  const [rows, totalDocs] = await Promise.all([
    StoreArticle.find(filter)
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-content -mediaRefs')
      .lean(),
    StoreArticle.countDocuments(filter),
  ]);
  const list = rows as unknown as StoredArticleRow[];
  const covers = await coverUrls(storeId, list);
  const data = list
    .map((row) => toStorefrontArticleSummary(row, { coverImageUrl: covers.get(String((row as { coverImage?: unknown }).coverImage)) ?? null }))
    .filter((item): item is StorefrontArticleSummary => item !== null);
  return { data, page, totalPages: Math.max(1, Math.ceil(totalDocs / limit)), totalDocs };
}

/** One published blog article by slug, or null (unknown, a draft, archived, another type). */
export async function findPublishedArticle(storeId: string, slug: string): Promise<StorefrontArticle | null> {
  if (!isPlainSlug(slug)) return null;
  const row = (await StoreArticle.findOne({ ...publicArticleFilter(storeId), slug }).select('-mediaRefs').lean()) as unknown as StoredArticleRow | null;
  if (!row) return null;
  const covers = await coverUrls(storeId, [row]);
  return toStorefrontArticle(row, { coverImageUrl: covers.get(String((row as { coverImage?: unknown }).coverImage)) ?? null });
}

/** The published pages of a store in footer order (title and address only: no text). */
export async function listPublishedPages(storeId: string): Promise<StorefrontPageLink[]> {
  const rows = (await StorePage.find(publicPageFilter(storeId)).sort({ sortOrder: 1, title: 1 }).limit(100).select('title slug showInFooter sortOrder status updatedAt').lean()) as unknown as StoredPageRow[];
  return rows.map(toStorefrontPageLink).filter((link): link is StorefrontPageLink => link !== null);
}

export type PageLookup = { kind: 'found'; page: StorefrontPage } | { kind: 'draft' } | { kind: 'none' };

/**
 * One page by slug. A page that exists but is not published is `draft`, so the storefront shows a 404 and never falls back to its default copy; a slug the
 * store has no page for is `none`, so the default copy (about, contact) can be used.
 */
export async function findPage(storeId: string, slug: string): Promise<PageLookup> {
  if (!isPlainSlug(slug)) return { kind: 'none' };
  const row = (await StorePage.findOne({ store: storeId, slug }).select('-mediaRefs').lean()) as unknown as StoredPageRow | null;
  if (!row) return { kind: 'none' };
  const page = toStorefrontPage(row);
  return page === null ? { kind: 'draft' } : { kind: 'found', page };
}
