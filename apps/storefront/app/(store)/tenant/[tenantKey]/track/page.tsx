import { queryParam } from "@/lib/query-param";
import { getTenantTheme } from "@/lib/themes";

const ORDER_REFERENCE_MAX = 40;

/** Order tracking. An ?order= reference prefills the form, which is how the confirmation page links here. */
export default async function TenantTrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantKey: string }>;
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const { tenantKey } = await params;
  const orderId = queryParam((await searchParams).order, ORDER_REFERENCE_MAX);
  const { OrderTracking } = (await getTenantTheme(tenantKey)).pages;
  return <OrderTracking orderId={orderId || undefined} />;
}
