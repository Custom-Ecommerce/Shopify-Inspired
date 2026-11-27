import { ErrorState } from '@markaz/mobile-kit';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { OrderDetailScreen } from '../../../src/screens/order-detail';

export default function Order() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // The id comes from a link: anything but a record id opens nothing.
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) return <ErrorState message="This order cannot be opened." />;
  return <OrderDetailScreen key={id} orderId={id} onOpenPending={() => router.push('/pending' as Href)} />;
}
