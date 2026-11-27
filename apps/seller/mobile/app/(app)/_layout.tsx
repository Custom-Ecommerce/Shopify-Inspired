import { useQueueSync } from '@markaz/mobile-kit';
import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { PushWiring } from '../../src/push-wiring';
import { StoreProvider, useServices } from '../../src/services';

/** Sends the changes made without a network, when it can. Renders nothing. */
function QueueSync() {
  useQueueSync(useServices().runtime);
  return null;
}

export default function AppLayout() {
  const router = useRouter();
  const open = useCallback((path: string) => router.push(path as Href), [router]);
  return (
    <StoreProvider>
      <PushWiring open={open} />
      <QueueSync />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="orders/[id]" options={{ title: 'Order' }} />
        <Stack.Screen name="products/[id]" options={{ title: 'Product' }} />
        <Stack.Screen name="customers/[key]" options={{ title: 'Customer' }} />
        <Stack.Screen name="alerts" options={{ title: 'Alerts' }} />
        <Stack.Screen name="stores" options={{ title: 'Your stores' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="pending" options={{ title: 'Pending changes' }} />
      </Stack>
    </StoreProvider>
  );
}
