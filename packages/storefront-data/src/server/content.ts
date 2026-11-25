import { TransportUnavailableError } from "../transport/errors";
import type { TransportUnavailableReason } from "../transport/errors";
import type { StorefrontTransport } from "../transport/types";
import type { StorefrontPageLink } from "../transport/content-types";
import { contentFooterLinks, toArticleCardVM, toArticleVM, toContentPageVM } from "../domain/content";
import type { ArticleCardVM, ArticleVM, ContentPageVM, FooterLink } from "../domain/content";

/**
 * Sprint 7 (S7-B3): what the storefront's blog and page routes load. A missing article, a draft page and an unreachable backend are VALUES, so each route
 * answers with the right page. A transport without the blog methods (a test double, an older mock) has no blog: that is `not-found`, never an error.
 */

export type BlogListData =
  | { status: "ok"; articles: ArticleCardVM[]; page: number; totalPages: number }
  | { status: "unavailable"; reason: TransportUnavailableReason };

export async function loadBlogList(transport: StorefrontTransport, page = 1, limit = 12): Promise<BlogListData> {
  try {
    if (!transport.listArticles) return { status: "ok", articles: [], page: 1, totalPages: 1 };
    const list = await transport.listArticles(page, limit);
    return { status: "ok", articles: list.items.map(toArticleCardVM), page: list.page, totalPages: list.totalPages };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}

export type ArticlePageData =
  | { status: "ok"; article: ArticleVM }
  | { status: "not-found" }
  | { status: "unavailable"; reason: TransportUnavailableReason };

export async function loadArticlePage(transport: StorefrontTransport, slug: string): Promise<ArticlePageData> {
  try {
    if (!transport.getArticle) return { status: "not-found" };
    const article = await transport.getArticle(slug);
    return article === null ? { status: "not-found" } : { status: "ok", article: toArticleVM(article) };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}

/**
 * A static page: the store's own published page, `draft` (404, and no default copy), or `none` (the caller may fall back to its default copy).
 */
export type ContentPageData =
  | { status: "ok"; page: ContentPageVM }
  | { status: "draft" }
  | { status: "none" }
  | { status: "unavailable"; reason: TransportUnavailableReason };

export async function loadContentPage(transport: StorefrontTransport, slug: string): Promise<ContentPageData> {
  try {
    if (!transport.getPage) return { status: "none" };
    const found = await transport.getPage(slug);
    if (found.kind === "found") return { status: "ok", page: toContentPageVM(found.page) };
    return { status: found.kind };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}

/**
 * The footer links the content adds (the pages the seller put in the footer, then Blog when there is an article). It never throws: a backend that cannot be
 * reached gives no extra links, so the whole store never fails because of its footer.
 */
export async function loadContentFooterLinks(transport: StorefrontTransport): Promise<FooterLink[]> {
  try {
    const [pages, articles] = await Promise.all([
      transport.listPages ? transport.listPages() : Promise.resolve([] as StorefrontPageLink[]),
      transport.listArticles ? transport.listArticles(1, 1) : Promise.resolve(null),
    ]);
    return contentFooterLinks(pages, articles !== null && articles.totalDocs > 0);
  } catch (error) {
    if (error instanceof TransportUnavailableError) return [];
    throw error;
  }
}

export interface SitemapData {
  articles: Array<{ slug: string; publishedAt: string | null }>;
  pages: Array<{ slug: string; updatedAt: string | null }>;
}

/** Every published article (at most 500) and page of the store, for its sitemap. An unreachable backend gives an empty sitemap body, never an error. */
export async function loadSitemapData(transport: StorefrontTransport): Promise<SitemapData> {
  const data: SitemapData = { articles: [], pages: [] };
  try {
    if (transport.listPages) data.pages = (await transport.listPages()).map((page) => ({ slug: page.slug, updatedAt: page.updatedAt }));
    if (transport.listArticles) {
      for (let page = 1; page <= 10; page += 1) {
        const list = await transport.listArticles(page, 50);
        data.articles.push(...list.items.map((article) => ({ slug: article.slug, publishedAt: article.publishedAt })));
        if (page >= list.totalPages) break;
      }
    }
  } catch (error) {
    if (!(error instanceof TransportUnavailableError)) throw error;
  }
  return data;
}
