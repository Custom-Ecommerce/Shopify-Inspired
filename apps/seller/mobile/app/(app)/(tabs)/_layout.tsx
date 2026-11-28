import { Contact, LayoutDashboard, Package, Settings, ShoppingCart, tab, useTabBarOptions } from '@markaz/mobile-kit';
import { Tabs } from 'expo-router';
import { useCan } from '../../../src/components/can';
import { SellerHeader } from '../../../src/components/seller-header';
import { useStoreChoice } from '../../../src/services';

export default function TabsLayout() {
  const { store } = useStoreChoice();
  const products = useCan('products.read');
  const customers = useCan('customers.read');
  const bar = useTabBarOptions();
  // A tab the role does not have is not shown (while the store is loading, nothing is hidden).
  const href = (allowed: boolean) => (!store || allowed ? undefined : null);
  return (
    <Tabs screenOptions={{ ...bar, header: ({ options }) => <SellerHeader title={options.title ?? ''} /> }}>
      {/* The web dashboard's names and icons (DashboardSidebar). */}
      <Tabs.Screen name="index" options={tab('Overview', LayoutDashboard)} />
      <Tabs.Screen name="orders" options={tab('Orders', ShoppingCart)} />
      <Tabs.Screen name="products" options={{ ...tab('Products', Package), href: href(products) }} />
      <Tabs.Screen name="customers" options={{ ...tab('Customers', Contact), href: href(customers) }} />
      <Tabs.Screen name="settings" options={tab('Settings', Settings)} />
    </Tabs>
  );
}
