import { notFound } from 'next/navigation';
import { getTenantTheme } from '@/lib/themes';

/** Order ids the backend issues: "ORD-" and eight characters from its unambiguous alphabet (see order-id.ts). */
const ORDER_ID = /^ORD-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export default async function TenantOrderPage({
  params,
}: {
  params: Promise<{ tenantKey: string; orderId: string }>;
}) {
  const { tenantKey, orderId } = await params;
  if (!ORDER_ID.test(orderId)) notFound();
  const { OrderConfirmation } = (await getTenantTheme(tenantKey)).pages;
  return <OrderConfirmation orderId={orderId} />;
}
