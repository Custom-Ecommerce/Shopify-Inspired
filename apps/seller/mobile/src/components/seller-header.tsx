import { sellerCan } from '@markaz/auth/seller-capabilities';
import { AppHeader, Bell, IconButton, Store, SwitcherChip } from '@markaz/mobile-kit';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { fetchUnreadAlerts } from '../api';
import { roleLabel } from '../labels';
import { useServices, useStoreChoice, useStoreKey } from '../services';

/** The header of every tab: the title, the alerts bell with the unread count, and the store switcher (the store and the role in it) under the title. */
export function SellerHeader({ title }: { title: string }) {
  const router = useRouter();
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  // The same query as the dashboard's tile: one request, one cache.
  const alerts = useQuery({
    queryKey: key('alerts', 'unread'),
    queryFn: () => fetchUnreadAlerts(runtime.client, storeId),
    enabled: storeId !== '' && sellerCan(store?.role, 'alerts.read'),
  });
  return (
    <AppHeader
      title={title}
      actions={
        store && sellerCan(store.role, 'alerts.read') ? <IconButton icon={Bell} label="Alerts" badge={alerts.data} onPress={() => router.push('/alerts' as Href)} /> : null
      }
      below={store ? <SwitcherChip icon={Store} label={store.name} detail={roleLabel(store.role)} onPress={() => router.push('/stores' as Href)} /> : undefined}
    />
  );
}
