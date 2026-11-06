import { notFound } from "next/navigation";
import { requireDemoTheme } from "@/lib/themes";

export default async function DemoOrderPage({
  params,
}: {
  params: Promise<{ themeSlug: string; orderId: string }>;
}) {
  const { themeSlug, orderId } = await params;
  const { OrderConfirmation } = (await requireDemoTheme(themeSlug)).pages;
  // Mock order ids have the form ORD-<number>. A real backend will look the order up instead.
  if (!/^ORD-[0-9]+$/.test(orderId)) notFound();
  return <OrderConfirmation orderId={orderId} />;
}
