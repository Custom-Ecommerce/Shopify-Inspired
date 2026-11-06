import { notFound } from "next/navigation";
import { CONTENT_PAGES } from "@/lib/content-pages";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoContentPage({ params }: { params: Promise<{ themeSlug: string; slug: string }> }) {
  const { themeSlug, slug } = await params;
  const page = Object.prototype.hasOwnProperty.call(CONTENT_PAGES, slug) ? CONTENT_PAGES[slug] : undefined;
  if (!page) notFound();
  const { Content } = (await requireDemoTheme(themeSlug)).pages;
  return <Content title={page.title} body={page.body} />;
}
