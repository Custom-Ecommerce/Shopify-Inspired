import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { useStoreChoice } from '../../../src/services';
import { OrdersScreen } from '../../../src/screens/orders';

export default function Orders() {
  const router = useRouter();
  const { status } = useLocalSearchParams<{ status?: string }>();
  const { store } = useStoreChoice();
  const open = useCallback((id: string) => router.push(`/orders/${id}` as Href), [router]);
  // Another store starts with its own filters.
  return <OrdersScreen key={store?.id ?? 'none'} onOpenOrder={open} initialStatus={status || undefined} />;
}
