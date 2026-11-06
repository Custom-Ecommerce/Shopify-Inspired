import { notFound } from "next/navigation";
import type { ThemeSlug } from "@markaz/platform-kit/themes";
import { loadCatalogPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoProductsPage({
  params,
}: {
  params: Promise<{ themeSlug: string }>;
}) {
  const { themeSlug } = await params;
  const { Catalog } = (await requireDemoTheme(themeSlug)).pages;
  // Demo routes always resolve to fixtures (kind: "demo"), whatever STOREFRONT_DATA_SOURCE says.
  const transport = await resolveTransport({ kind: "demo", themeSlug: themeSlug as ThemeSlug });
  if (!transport) notFound();
  return <Catalog data={await loadCatalogPage(transport)} />;
}
