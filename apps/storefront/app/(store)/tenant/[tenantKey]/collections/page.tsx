import { notFound } from "next/navigation";
import { loadStoreChrome } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

/** All collections, derived from the store's products. Only for themes that provide the page. */
export default async function TenantCollectionsPage({ params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const { Collections } = (await getTenantTheme(tenantKey)).pages;
  if (!Collections) notFound();
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  if (!transport) notFound();
  const chrome = await loadStoreChrome(transport);
  return <Collections categories={chrome.categories} />;
}
