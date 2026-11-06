import { notFound } from "next/navigation";
import type { ThemeSlug } from "@markaz/platform-kit/themes";
import { MAX_SEARCH_LENGTH, storePaths } from "@markaz/storefront-data";
import { loadSearchPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { queryParam } from "@/lib/query-param";
import { requireDemoTheme } from "@/lib/themes";

/** Product search on the demo. The demo reads fixtures, so the search covers the demo catalogue. */
export default async function DemoSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ themeSlug: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { themeSlug } = await params;
  const { Search, Unavailable } = (await requireDemoTheme(themeSlug)).pages;
  const query = queryParam((await searchParams).q, MAX_SEARCH_LENGTH);
  const transport = await resolveTransport({ kind: "demo", themeSlug: themeSlug as ThemeSlug });
  if (!transport) notFound();

  const outcome = await loadSearchPage(transport, query);
  if (outcome.status === "unavailable") {
    return (
      <Unavailable
        message="Search is not available right now. Please try again in a moment."
        retryHref={query ? storePaths.searchFor(query) : storePaths.search}
      />
    );
  }
  return <Search query={query} results={outcome.results} />;
}
