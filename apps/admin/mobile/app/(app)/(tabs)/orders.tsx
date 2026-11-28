import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { Gate } from '../../../src/components/gate';
import { OrdersScreen } from '../../../src/screens/orders';

export default function Orders() {
  const router = useRouter();
  const open = useCallback((id: string) => router.push(`/orders/${id}` as Href), [router]);
  return (
    <Gate screen="orders">
      <OrdersScreen onOpenOrder={open} />
    </Gate>
  );
}
