import { requireDemoTheme } from "@/lib/themes";

export default async function DemoCheckoutPage({
  params,
}: {
  params: Promise<{ themeSlug: string }>;
}) {
  const { themeSlug } = await params;
  const { Checkout } = (await requireDemoTheme(themeSlug)).pages;
  return <Checkout />;
}
