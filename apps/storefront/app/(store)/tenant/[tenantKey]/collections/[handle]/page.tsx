import { notFound } from "next/navigation";
import { loadCollectionPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

export default async function TenantCollectionPage({ params }: { params: Promise<{ tenantKey: string; handle: string }> }) {
  const { tenantKey, handle } = await params;
  const { Collection, Unavailable } = (await getTenantTheme(tenantKey)).pages;
  if (!Collection) notFound();
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  if (!transport) notFound();
  const outcome = await loadCollectionPage(transport, handle);
  if (outcome.status === "not-found") notFound();
  if (outcome.status === "unavailable") return <Unavailable message="We could not load this collection just now." retryHref={"/collections/" + encodeURIComponent(handle)} />;
  return <Collection slug={handle} category={outcome.category} products={outcome.products} />;
}
