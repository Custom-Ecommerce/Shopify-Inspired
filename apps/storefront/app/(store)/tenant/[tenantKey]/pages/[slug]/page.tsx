import { notFound } from "next/navigation";
import { CONTENT_PAGES } from "@/lib/content-pages";
import { getTenantTheme } from "@/lib/themes";

export default async function TenantContentPage({ params }: { params: Promise<{ tenantKey: string; slug: string }> }) {
  const { tenantKey, slug } = await params;
  const page = Object.prototype.hasOwnProperty.call(CONTENT_PAGES, slug) ? CONTENT_PAGES[slug] : undefined;
  if (!page) notFound();
  const { Content } = (await getTenantTheme(tenantKey)).pages;
  return <Content title={page.title} body={page.body} />;
}
