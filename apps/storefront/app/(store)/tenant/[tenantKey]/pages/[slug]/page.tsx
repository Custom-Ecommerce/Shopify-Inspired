import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { storePaths } from "@markaz/storefront-data";
import { loadContentPage } from "@markaz/storefront-data/server";
import { contentToPlainText } from "@markaz/platform-kit/content-markdown";
import { CONTENT_PAGES } from "@/lib/content-pages";
import { resolveStore } from "@/lib/tenancy/resolve-store";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

type Params = { params: Promise<{ tenantKey: string; slug: string }> };

/** The platform's default copy for an address, when it has some. */
function defaultCopy(slug: string): { title: string; body: string } | undefined {
  return Object.prototype.hasOwnProperty.call(CONTENT_PAGES, slug) ? CONTENT_PAGES[slug] : undefined;
}

/** One read per request: the page and its metadata share it. A store that cannot be read has no page of its own, so its default copy still shows. */
const loadPage = cache(async (tenantKey: string, slug: string) => {
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  return transport ? loadContentPage(transport, slug) : ({ status: "none" } as const);
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tenantKey, slug } = await params;
  const outcome = await loadPage(tenantKey, slug);
  const title = outcome.status === "ok" ? outcome.page.title : outcome.status === "none" ? defaultCopy(slug)?.title : undefined;
  if (title === undefined) return {};
  const result = await resolveStore(tenantKey, "slug");
  const full = result.outcome === "ok" ? title + " | " + result.store.name : title;
  return { title: { absolute: full }, alternates: { canonical: storePaths.page(slug) }, openGraph: { type: "website", title: full } };
}

/**
 * Sprint 7 (S7-B3): a static page. The store's own PUBLISHED page comes first, as the safe tree. A store with no page at that address falls back to the
 * platform's default copy (lib/content-pages.ts: about, contact). A page the seller has not published (a draft) is a 404 and never falls back: the seller
 * chose to have their own page there. A backend that cannot be reached shows the default copy when there is one, else the unavailable page.
 */
export default async function TenantContentPage({ params }: Params) {
  const { tenantKey, slug } = await params;
  const { Content, Unavailable } = (await getTenantTheme(tenantKey)).pages;
  const outcome = await loadPage(tenantKey, slug);

  if (outcome.status === "ok") {
    return <Content title={outcome.page.title} body={contentToPlainText(outcome.page.content)} content={outcome.page.content} slug={slug} />;
  }
  if (outcome.status === "draft") notFound();

  const fallback = defaultCopy(slug);
  if (outcome.status === "none" || outcome.status === "unavailable") {
    if (fallback) return <Content title={fallback.title} body={fallback.body} slug={slug} />;
    if (outcome.status === "unavailable") {
      return <Unavailable message="We could not load this page just now. Please try again in a moment." retryHref={storePaths.page(slug)} />;
    }
  }
  notFound();
}
