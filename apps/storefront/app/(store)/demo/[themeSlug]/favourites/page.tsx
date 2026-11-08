import { notFound } from "next/navigation";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoFavouritesPage({ params }: { params: Promise<{ themeSlug: string }> }) {
  const { themeSlug } = await params;
  const { Favourites } = (await requireDemoTheme(themeSlug)).pages;
  if (!Favourites) notFound();
  return <Favourites />;
}
