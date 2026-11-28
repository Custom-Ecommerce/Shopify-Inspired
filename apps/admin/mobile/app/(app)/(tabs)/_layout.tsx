import { AppHeader, CreditCard, LayoutDashboard, LifeBuoy, MoreHorizontal, RefreshCw, ShoppingCart, tab, Users, useTabBarOptions } from '@markaz/mobile-kit';
import { Tabs } from 'expo-router';
import { tabsFor, type AdminTab } from '../../../src/access';
import { useAdminLevel } from '../../../src/services';

/*
 * A screen that is not one of the level's tabs gets no tab button but stays a screen that can be opened, from More or from a notification. `href: null`
 * would not do: the router then refuses to go there at all and lands on the first tab.
 */
const NO_BUTTON = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const } };

export default function TabsLayout() {
  const tabs = tabsFor(useAdminLevel());
  const bar = useTabBarOptions();
  const visible = (screen: AdminTab) => (tabs.includes(screen) ? {} : NO_BUTTON);
  return (
    <Tabs screenOptions={{ ...bar, header: ({ options }) => <AppHeader title={options.title ?? ''} subtitle="Markazify admin" /> }}>
      <Tabs.Screen name="index" options={{ ...tab('Overview', LayoutDashboard), ...visible('overview') }} />
      <Tabs.Screen name="orders" options={{ ...tab('Orders', ShoppingCart), ...visible('orders') }} />
      <Tabs.Screen name="payments" options={{ ...tab('Payments', CreditCard), ...visible('payments') }} />
      <Tabs.Screen name="tickets" options={{ ...tab('Tickets', LifeBuoy), ...visible('tickets') }} />
      <Tabs.Screen name="sellers" options={{ ...tab('Sellers', Users), ...visible('sellers') }} />
      <Tabs.Screen name="sync" options={{ ...tab('Sync', RefreshCw), ...visible('sync') }} />
      <Tabs.Screen name="more" options={tab('More', MoreHorizontal)} />
    </Tabs>
  );
}
