import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { CustomersScreen } from '../../../src/screens/customers';
import { useStoreChoice } from '../../../src/services';

export default function Customers() {
  const router = useRouter();
  const { store } = useStoreChoice();
  const open = useCallback((key: string) => router.push({ pathname: '/customers/[key]', params: { key } } as unknown as Href), [router]);
  return <CustomersScreen key={store?.id ?? 'none'} onOpenCustomer={open} />;
}
