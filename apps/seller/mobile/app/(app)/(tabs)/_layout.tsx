import { colors, fontSize, MIN_TAP_TARGET } from '@markaz/mobile-kit';
import { Tabs } from 'expo-router';
import { useCan } from '../../../src/components/can';
import { useStoreChoice } from '../../../src/services';

export default function TabsLayout() {
  const { store } = useStoreChoice();
  const products = useCan('products.read');
  const customers = useCan('customers.read');
  // A tab the role does not have is not shown (while the store is loading, nothing is hidden).
  const tab = (allowed: boolean) => (!store || allowed ? undefined : null);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        // Words only: large enough to read and to tap.
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: fontSize.caption, fontWeight: '600' },
        tabBarItemStyle: { minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="products" options={{ title: 'Products', href: tab(products) }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers', href: tab(customers) }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
