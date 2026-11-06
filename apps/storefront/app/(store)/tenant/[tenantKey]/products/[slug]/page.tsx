import { notFound } from "next/navigation";
import { storePaths } from "@markaz/storefront-data";
import { loadProductPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

/**
 * A product on a live store, read on the server through the store's own transport. A product the store does not have is
 * a 404. A backend that cannot be reached shows the theme's unavailable page, with a link back to this product. Anything
 * unexpected reaches the tenant error boundary.
 */
export default async function TenantProductPage({
  params,
}: {
  params: Promise<{ tenantKey: string; slug: string }>;
}) {
  const { tenantKey, slug } = await params;
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  if (!transport) notFound();

  const { Product, Unavailable } = (await getTenantTheme(tenantKey)).pages;
  const outcome = await loadProductPage(transport, slug);
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
