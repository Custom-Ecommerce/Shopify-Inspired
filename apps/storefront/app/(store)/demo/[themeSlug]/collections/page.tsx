import { notFound } from "next/navigation";
import type { ThemeSlug } from "@markaz/platform-kit/themes";
import { loadStoreChrome } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoCollectionsPage({ params }: { params: Promise<{ themeSlug: string }> }) {
  const { themeSlug } = await params;
  const { Collections } = (await requireDemoTheme(themeSlug)).pages;
  if (!Collections) notFound();
  const transport = await resolveTransport({ kind: "demo", themeSlug: themeSlug as ThemeSlug });
  if (!transport) notFound();
  const chrome = await loadStoreChrome(transport);
  return <Collections categories={chrome.categories} />;
}
