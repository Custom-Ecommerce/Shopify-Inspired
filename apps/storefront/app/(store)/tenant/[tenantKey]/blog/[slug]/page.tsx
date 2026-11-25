import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { articleDescription, articleTitle, storePaths } from "@markaz/storefront-data";
import { loadArticlePage } from "@markaz/storefront-data/server";
import { resolveStore } from "@/lib/tenancy/resolve-store";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

type Params = { params: Promise<{ tenantKey: string; slug: string }> };

/** One read per request: the page and its metadata share it. */
const loadArticle = cache(async (tenantKey: string, slug: string) => {
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  return transport ? loadArticlePage(transport, slug) : null;
});

/**
 * Sprint 7 (S7-B3): the tags of an article: its title (the SEO title when the seller wrote one), a description, the canonical address on the store's own
 * host, and Open Graph. A draft or unknown article has none: the page is a 404.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tenantKey, slug } = await params;
  const outcome = await loadArticle(tenantKey, slug);
  if (outcome?.status !== "ok") return {};
  const { article } = outcome;
  const result = await resolveStore(tenantKey, "slug");
  const siteName = result.outcome === "ok" ? result.store.name : undefined;
  const title = articleTitle(article) + (siteName ? " | " + siteName : "");
  const description = articleDescription({ excerpt: article.excerpt, seoDescription: article.seoDescription }) ?? undefined;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: storePaths.article(slug) },
    openGraph: {
      type: "article",
      title,
      description,
      siteName,
      ...(article.dateIso ? { publishedTime: article.dateIso } : {}),
      ...(article.coverUrl ? { images: [article.coverUrl] } : {}),
    },
    twitter: { card: article.coverUrl ? "summary_large_image" : "summary", title, description, ...(article.coverUrl ? { images: [article.coverUrl] } : {}) },
  };
}

/** One published article. A draft, an archived article and an unknown slug are the same 404. A backend that cannot be reached shows the theme's unavailable page. */
export default async function TenantArticlePage({ params }: Params) {
  const { tenantKey, slug } = await params;
  const { BlogPost, Unavailable } = (await getTenantTheme(tenantKey)).pages;
  if (!BlogPost) notFound();
  const outcome = await loadArticle(tenantKey, slug);
  if (!outcome || outcome.status === "not-found") notFound();
  if (outcome.status === "unavailable") {
    return <Unavailable message="We could not load this article just now. Please try again in a moment." retryHref={storePaths.article(slug)} />;
  }
  return <BlogPost article={outcome.article} />;
}
