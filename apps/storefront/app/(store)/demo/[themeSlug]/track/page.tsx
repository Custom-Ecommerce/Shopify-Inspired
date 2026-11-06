import { queryParam } from "@/lib/query-param";
import { requireDemoTheme } from "@/lib/themes";

const ORDER_REFERENCE_MAX = 40;

/** Order tracking on the demo. Orders placed in this session are found; the demo keeps nothing between sessions. */
export default async function DemoTrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ themeSlug: string }>;
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const { themeSlug } = await params;
  const { OrderTracking } = (await requireDemoTheme(themeSlug)).pages;
  const orderId = queryParam((await searchParams).order, ORDER_REFERENCE_MAX);
  return <OrderTracking orderId={orderId || undefined} />;
}
