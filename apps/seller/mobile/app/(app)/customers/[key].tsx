import { ErrorState } from '@markaz/mobile-kit';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { CustomerDetailScreen } from '../../../src/screens/customer-detail';

export default function Customer() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  // The server reads a phone or an email and nothing else.
  if (typeof key !== 'string' || !/^(\+?\d{7,15}|[^\s@/]+@[^\s@/]+)$/.test(key)) return <ErrorState message="This customer cannot be opened." />;
  return <CustomerDetailScreen key={key} customerKey={key} onOpenOrder={(id) => router.push(`/orders/${id}` as Href)} />;
}
