import { notFound } from "next/navigation";
import { queryParam } from "@/lib/query-param";
import { getTenantTheme } from "@/lib/themes";

export default async function TenantFeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantKey: string }>;
  searchParams: Promise<{ product?: string | string[]; order?: string | string[] }>;
}) {
  const { tenantKey } = await params;
  const query = await searchParams;
  const { Feedback } = (await getTenantTheme(tenantKey)).pages;
  if (!Feedback) notFound();
  return <Feedback productSlug={queryParam(query.product, 120) || undefined} orderId={queryParam(query.order, 40) || undefined} />;
}
