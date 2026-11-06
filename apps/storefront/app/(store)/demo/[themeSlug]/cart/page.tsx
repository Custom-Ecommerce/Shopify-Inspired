import { requireDemoTheme } from "@/lib/themes";

export default async function DemoCartPage({
  params,
}: {
  params: Promise<{ themeSlug: string }>;
}) {
  const { themeSlug } = await params;
  const { Cart } = (await requireDemoTheme(themeSlug)).pages;
  return <Cart />;
}
