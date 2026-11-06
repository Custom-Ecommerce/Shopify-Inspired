import { notFound } from "next/navigation";
import { MAX_SEARCH_LENGTH, storePaths } from "@markaz/storefront-data";
import { loadSearchPage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { queryParam } from "@/lib/query-param";
import { getTenantTheme } from "@/lib/themes";

/** Product search for a live store. The query comes from the q parameter that the header search form submits. */
export default async function TenantSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantKey: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { tenantKey } = await params;
  const query = queryParam((await searchParams).q, MAX_SEARCH_LENGTH);
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  if (!transport) notFound();

  const { Search, Unavailable } = (await getTenantTheme(tenantKey)).pages;
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
