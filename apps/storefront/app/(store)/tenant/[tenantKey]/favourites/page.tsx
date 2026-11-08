import { notFound } from "next/navigation";
import { getTenantTheme } from "@/lib/themes";

/** The shopper's favourites. The list lives in the browser, so the theme's page loads it there. */
export default async function TenantFavouritesPage({ params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const { Favourites } = (await getTenantTheme(tenantKey)).pages;
  if (!Favourites) notFound();
  return <Favourites />;
}
