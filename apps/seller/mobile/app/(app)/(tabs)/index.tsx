import { useRouter, type Href } from 'expo-router';
import { DashboardScreen } from '../../../src/screens/dashboard';

export default function Home() {
  const router = useRouter();
  return (
    <DashboardScreen
      onOpenOrder={(id) => router.push(`/orders/${id}` as Href)}
      onOpenOrders={(filter) => router.push({ pathname: '/orders', params: { status: filter?.status ?? '' } } as Href)}
      onSwitchStore={() => router.push('/stores' as Href)}
      onOpenLowStock={() => router.push({ pathname: '/products', params: { stock: 'low' } } as Href)}
      onOpenAlerts={() => router.push('/alerts' as Href)}
      onOpenPending={() => router.push('/pending' as Href)}
    />
  );
}
