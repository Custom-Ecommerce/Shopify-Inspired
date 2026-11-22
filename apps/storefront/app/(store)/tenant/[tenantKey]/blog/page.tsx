import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { storePaths } from "@markaz/storefront-data";
import { loadBlogList } from "@markaz/storefront-data/server";
import { resolveStore } from "@/lib/tenancy/resolve-store";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

type Props = { params: Promise<{ tenantKey: string }>; searchParams: Promise<{ page?: string | string[] }> };

/** A page number from the query: a whole number from 1; anything else is page 1. */
function pageNumber(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = value === undefined ? 1 : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 10000 ? parsed : 1;
}

/** One read per request: the page and its metadata share it. */
const loadList = cache(async (tenantKey: string, page: number) => {
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  return transport ? loadBlogList(transport, page) : null;
});

/** Sprint 7 (S7-B3): the blog's tags. The canonical address is the page's own; the layout supplies the origin and the live or noindex robots. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { tenantKey } = await params;
  const page = pageNumber((await searchParams).page);
  const result = await resolveStore(tenantKey, "slug");
  if (result.outcome !== "ok") return {};
  const title = "Journal | " + result.store.name;
  const canonical = page > 1 ? storePaths.blog + "?page=" + page : storePaths.blog;
  return { title: { absolute: title }, alternates: { canonical }, openGraph: { type: "website", title, siteName: result.store.name } };
}

/**
 * The store's blog, read on the server through the store's own transport (cached under the store's static tag, which a publish, unpublish, edit or delete
 * of an article drops). A theme without a blog page answers 404. A backend that cannot be reached shows the theme's unavailable page.
 */
export default async function TenantBlogPage({ params, searchParams }: Props) {
  const { tenantKey } = await params;
  const page = pageNumber((await searchParams).page);
  const { Blog, Unavailable } = (await getTenantTheme(tenantKey)).pages;
  if (!Blog) notFound();
  const outcome = await loadList(tenantKey, page);
  if (!outcome) notFound();
  if (outcome.status === "unavailable") {
    return <Unavailable message="We could not load the journal just now. Please try again in a moment." retryHref={storePaths.blog} />;
  }
  return <Blog articles={outcome.articles} page={outcome.page} totalPages={outcome.totalPages} />;
}
