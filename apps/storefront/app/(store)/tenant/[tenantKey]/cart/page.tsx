import { getTenantTheme } from '@/lib/themes';

/** The store's cart. Its contents and prices come from the storefront provider the tenant layout mounts. */
export default async function TenantCartPage({ params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const { Cart } = (await getTenantTheme(tenantKey)).pages;
  return <Cart />;
}
