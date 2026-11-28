import { ErrorState } from '@markaz/mobile-kit';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ProductDetailScreen } from '../../../src/screens/product-detail';

export default function Product() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) return <ErrorState message="This product cannot be opened." />;
  return <ProductDetailScreen key={id} productId={id} onOpenPending={() => router.push('/pending' as Href)} />;
}
