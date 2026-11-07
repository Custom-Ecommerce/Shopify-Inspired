import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { storePaths } from "@markaz/storefront-data";
import { loadProductPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

type Params = { params: Promise<{ tenantKey: string; slug: string }> };

/** One read per request: the page and its metadata share it. */
const loadPage = cache(async (tenantKey: string, slug: string) => {
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  return transport ? loadProductPage(transport, slug) : null;
});

/** The tags of a product page, from the data layer's fallbacks. What is not Live has none: the page is a 404. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tenantKey, slug } = await params;
  const outcome = await loadPage(tenantKey, slug);
  if (outcome?.status !== "ok") return {};
  const { title, description, imageUrl } = outcome.product.seo;
  return {
    title: { absolute: title },
    description,
    openGraph: { title, description: description ?? undefined, images: imageUrl ? [imageUrl] : undefined },
  };
}

/**
 * A product on a live store, read on the server through the store's own transport. A product the store does not have is
 * a 404. A backend that cannot be reached shows the theme's unavailable page, with a link back to this product. Anything
 * unexpected reaches the tenant error boundary.
 */
export default async function TenantProductPage({
  params,
}: Params) {
  const { tenantKey, slug } = await params;
  const outcome = await loadPage(tenantKey, slug);
  if (!outcome) notFound();

  const { Product, Unavailable } = (await getTenantTheme(tenantKey)).pages;
  if (outcome.status === "not-found") notFound();
  if (outcome.status === "unavailable") {
    return (
      <Unavailable
        message="We could not load this product just now. Please try again in a moment."
        retryHref={storePaths.product(slug)}
      />
    );
  }
  return <Product slug={slug} product={outcome.product} />;
}
