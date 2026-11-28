import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { ProductsScreen } from '../../../src/screens/products';
import { useStoreChoice } from '../../../src/services';

export default function Products() {
  const router = useRouter();
  const { stock } = useLocalSearchParams<{ stock?: string }>();
  const { store } = useStoreChoice();
  const open = useCallback((id: string) => router.push(`/products/${id}` as Href), [router]);
  return <ProductsScreen key={store?.id ?? 'none'} onOpenProduct={open} initialLowStock={stock === 'low'} />;
}
