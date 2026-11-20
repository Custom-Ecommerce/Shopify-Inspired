import { notFound } from 'next/navigation';
import { customerToSellerWhatsappLink } from '@markaz/notifications/whatsapp';
import { getTenantTheme } from '@/lib/themes';
import { resolveStore } from '@/lib/tenancy/resolve-store';

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
  // The layout already resolved the store (resolveStore is cached per request), so this costs no extra call.
  const result = await resolveStore(tenantKey, 'slug');
  const sellerWhatsappLink =
    result.outcome === 'ok' ? customerToSellerWhatsappLink(result.store.commerce.whatsappNumber, result.store.name, orderId) : null;
  return <OrderConfirmation orderId={orderId} sellerWhatsappLink={sellerWhatsappLink} />;
}
