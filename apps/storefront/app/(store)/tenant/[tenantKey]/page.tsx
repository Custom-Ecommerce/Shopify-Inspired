import { notFound } from "next/navigation";
import { loadHomePage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { getTenantTheme } from "@/lib/themes";

/** The live store's home page, rendered by the store's theme from the store's own catalogue. */
export default async function TenantPage({
  params,
}: {
  params: Promise<{ tenantKey: string }>;
}) {
  const { tenantKey } = await params;
  const transport = await resolveTransport({ kind: "tenant", key: tenantKey });
  if (!transport) notFound();
  const theme = await getTenantTheme(tenantKey);
  const { Home, Unavailable } = theme.pages;
  const outcome = await loadHomePage(transport);
  if (outcome.status === "unavailable") {
    return <Unavailable message="We could not load this store just now. Please try again in a moment." retryHref="/" />;
  }
  return <Home {...outcome.data} />;
}
