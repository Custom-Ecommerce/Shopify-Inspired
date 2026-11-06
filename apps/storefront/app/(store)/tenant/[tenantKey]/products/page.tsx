import { notFound } from "next/navigation";
import { loadCatalogPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

export default async function TenantProductsPage({
  params,
}: {
  params: Promise<{ tenantKey: string }>;
}) {
  const { tenantKey } = await params;
  // The tenant layout has already resolved the store. This call hits React's per-request cache.
  // The remote transport is bound to that store and talks to the seller backend.
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  if (!transport) notFound();
  const { Catalog } = (await getTenantTheme(tenantKey)).pages;
  return <Catalog data={await loadCatalogPage(transport)} />;
}
