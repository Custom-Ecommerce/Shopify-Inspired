import { notFound } from "next/navigation";
import { queryParam } from "@/lib/query-param";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoFeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ themeSlug: string }>;
  searchParams: Promise<{ product?: string | string[]; order?: string | string[] }>;
}) {
  const { themeSlug } = await params;
  const query = await searchParams;
  const { Feedback } = (await requireDemoTheme(themeSlug)).pages;
  if (!Feedback) notFound();
  return <Feedback productSlug={queryParam(query.product, 120) || undefined} orderId={queryParam(query.order, 40) || undefined} />;
}
