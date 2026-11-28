import { useStackOptions } from '@markaz/mobile-kit';
import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { PushWiring } from '../../src/push-wiring';

export default function AppLayout() {
  const router = useRouter();
  const open = useCallback((path: string) => router.push(path as Href), [router]);
  const stack = useStackOptions();
  return (
    <>
      <PushWiring open={open} />
      <Stack screenOptions={stack}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="orders/[id]" options={{ title: 'Order' }} />
        <Stack.Screen name="payments/[id]" options={{ title: 'Payment' }} />
        <Stack.Screen name="tickets/[id]" options={{ title: 'Ticket' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      </Stack>
    </>
  );
}
