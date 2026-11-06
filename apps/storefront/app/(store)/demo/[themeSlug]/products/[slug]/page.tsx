import { notFound } from "next/navigation";
import type { ThemeSlug } from "@markaz/platform-kit/themes";
import { storePaths } from "@markaz/storefront-data";
import { loadProductPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoProductPage({
  params,
}: {
  params: Promise<{ themeSlug: string; slug: string }>;
}) {
  const { themeSlug, slug } = await params;
  const theme = await requireDemoTheme(themeSlug);
  const { Product, Unavailable } = theme.pages;
  // A theme without its own demo data loads the product in the browser, as it always has.
  if (!theme.demo) return <Product slug={slug} />;

  const transport = await resolveTransport({ kind: "demo", themeSlug: themeSlug as ThemeSlug });
  if (!transport) notFound();
  const outcome = await loadProductPage(transport, slug);
  if (outcome.status === "not-found") notFound();
  if (outcome.status === "unavailable") return <Unavailable message="The demo product could not be loaded." retryHref={storePaths.product(slug)} />;
  return <Product slug={slug} product={outcome.product} />;
}
