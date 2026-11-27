import { colors, fontSize, MIN_TAP_TARGET } from '@markaz/mobile-kit';
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
  const tab = (screen: AdminTab) => (tabs.includes(screen) ? {} : NO_BUTTON);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: fontSize.caption, fontWeight: '600' },
        tabBarItemStyle: { minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Overview', ...tab('overview') }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', ...tab('orders') }} />
      <Tabs.Screen name="payments" options={{ title: 'Payments', ...tab('payments') }} />
      <Tabs.Screen name="tickets" options={{ title: 'Tickets', ...tab('tickets') }} />
      <Tabs.Screen name="sellers" options={{ title: 'Sellers', ...tab('sellers') }} />
      <Tabs.Screen name="sync" options={{ title: 'Sync', ...tab('sync') }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
