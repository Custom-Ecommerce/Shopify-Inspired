import { notFound } from "next/navigation";
import type { ThemeSlug } from "@markaz/platform-kit/themes";
import { loadHomePage } from "@markaz/storefront-data/server";
import { resolveTransport } from "@/lib/sources";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoPage({
  params,
}: {
  params: Promise<{ themeSlug: string }>;
}) {
  const { themeSlug } = await params;
  const theme = await requireDemoTheme(themeSlug);
  const transport = await resolveTransport({ kind: "demo", themeSlug: themeSlug as ThemeSlug });
  if (!transport) notFound();
  const { Home, Unavailable } = theme.pages;
  const outcome = await loadHomePage(transport);
  if (outcome.status === "unavailable") return <Unavailable message="The demo could not be loaded." retryHref="/" />;
  return <Home {...outcome.data} />;
}
