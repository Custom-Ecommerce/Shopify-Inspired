import {
  AppText,
  Card,
  Contact,
  ErrorState,
  formatDateTime,
  formatRupees,
  History,
  ListRow,
  LoadingState,
  Mail,
  MapPin,
  NoConnection,
  Notice,
  OfflineBanner,
  Phone,
  Row,
  ScrollScreen,
  SectionHeader,
  StatusBadge,
  StickyNote,
  useIsOnline,
  Wrap,
} from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { fetchCustomer } from '../api';
import { OrderStatusBadge } from '../components/badges';
import { NotForYourRole, useCan } from '../components/can';
import { customerName, displayPhone, statusLabel } from '../labels';
import { useServices, useStoreChoice, useStoreKey } from '../services';

/** Read-only: the same facts the website's customer page shows. Notes and tags are changed there. */
export function CustomerDetailScreen({ customerKey, onOpenOrder }: { customerKey: string; onOpenOrder: (id: string) => void }) {
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  const allowed = useCan('customers.read');
  const online = useIsOnline();
  const detail = useQuery({ queryKey: key('customer', customerKey), queryFn: () => fetchCustomer(runtime.client, storeId, customerKey), enabled: storeId !== '' && allowed });

  if (store && !allowed) return <NotForYourRole />;
  const customer = detail.data;
  if (!customer && !online) return <NoConnection onRetry={() => void detail.refetch()} />;
  if (!customer) return detail.error ? <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} /> : <LoadingState rows={4} />;

  const { stats } = customer;
  return (
    <ScrollScreen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
      <OfflineBanner updatedAt={detail.dataUpdatedAt} />
      {online && detail.error ? <Notice text={`Showing what was saved at ${formatDateTime(detail.dataUpdatedAt)}. ${errorText(detail.error)}`} /> : null}
      <Card title={customerName(customer.name, customer.phone, customer.email)} icon={Contact}>
        {customer.phone ? <Row icon={Phone} label="Phone" value={displayPhone(customer.phone)} /> : null}
        {customer.whatsapp && customer.whatsapp !== customer.phone ? <Row icon={Phone} label="WhatsApp" value={displayPhone(customer.whatsapp)} /> : null}
        {customer.email ? <Row icon={Mail} label="Email" value={customer.email} /> : null}
        {customer.unsubscribed ? <StatusBadge label="Unsubscribed from your emails" tone="neutral" /> : null}
      </Card>
      <Card title="History" icon={History}>
        <Row label="Orders" value={String(stats.orderCount)} />
        <Row label="Delivered" value={String(stats.deliveredCount)} />
        <Row label="Cancelled" value={String(stats.cancelledCount)} />
        <Row label="Returns" value={String(stats.returnsCount)} />
        <Row label="Spent" value={formatRupees(stats.totalSpent)} strong />
        <Row label="First order" value={formatDateTime(stats.firstOrderAt)} />
      </Card>
      {customer.note || customer.tags.length > 0 ? (
        <Card title="Your note" icon={StickyNote}>
          {customer.tags.length > 0 ? (
            <Wrap gap="xs">
              {customer.tags.map((tag) => (
                <StatusBadge key={tag} label={tag} tone="info" />
              ))}
            </Wrap>
          ) : null}
          {customer.note ? <AppText>{customer.note}</AppText> : null}
        </Card>
      ) : null}
      <SectionHeader title="Orders" />
      <View>
        {customer.orders.map((order) => (
          <ListRow
            key={order.id}
            accessibilityLabel={`${order.orderId} · ${statusLabel(order.status)} · ${formatRupees(order.total)}`}
            onPress={() => onOpenOrder(order.id)}
            title={order.orderId}
            trailing={<AppText weight="semibold">{formatRupees(order.total)}</AppText>}
            meta={formatDateTime(order.createdAt)}
            footer={<OrderStatusBadge status={order.status} />}
          />
        ))}
      </View>
      {customer.addresses.length > 0 ? (
        <Card title="Addresses" icon={MapPin}>
          {customer.addresses.map((entry, index) => (
            <AppText key={index}>{[entry.address, entry.city].filter(Boolean).join(', ')}</AppText>
          ))}
        </Card>
      ) : null}
      <AppText variant="caption" tone="muted">
        Notes, tags and blocking are changed on the website.
      </AppText>
    </ScrollScreen>
  );
}
