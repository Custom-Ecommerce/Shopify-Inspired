import { getTenantTheme } from '@/lib/themes';

/** Checkout. Orders go through the store's BFF; the tenant layout has already checked the store is serving. */
export default async function TenantCheckoutPage({ params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const { Checkout } = (await getTenantTheme(tenantKey)).pages;
  return <Checkout />;
}
