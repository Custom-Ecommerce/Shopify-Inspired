import { notFound } from "next/navigation";
import type { ThemeSlug } from "@markaz/platform-kit/themes";
import { loadCollectionPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoCollectionPage({ params }: { params: Promise<{ themeSlug: string; handle: string }> }) {
  const { themeSlug, handle } = await params;
  const { Collection, Unavailable } = (await requireDemoTheme(themeSlug)).pages;
  if (!Collection) notFound();
  const transport = await resolveTransport({ kind: "demo", themeSlug: themeSlug as ThemeSlug });
  if (!transport) notFound();
  const outcome = await loadCollectionPage(transport, handle);
  if (outcome.status === "not-found") notFound();
  if (outcome.status === "unavailable") return <Unavailable message="The demo collection could not be loaded." retryHref={"/collections/" + encodeURIComponent(handle)} />;
  return <Collection slug={handle} category={outcome.category} products={outcome.products} />;
}
