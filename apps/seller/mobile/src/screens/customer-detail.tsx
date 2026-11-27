import { Button, Card, ErrorState, formatDateTime, formatRupees, LoadingState, NoConnection, Notice, OfflineBanner, Row, ScrollScreen, uiStyles, useIsOnline } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { fetchCustomer } from '../api';
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
      <Card>
        <Text accessibilityRole="header" style={uiStyles.title}>
          {customerName(customer.name, customer.phone, customer.email)}
        </Text>
        {customer.phone ? <Row label="Phone" value={displayPhone(customer.phone)} /> : null}
        {customer.whatsapp && customer.whatsapp !== customer.phone ? <Row label="WhatsApp" value={displayPhone(customer.whatsapp)} /> : null}
        {customer.email ? <Row label="Email" value={customer.email} /> : null}
        {customer.unsubscribed ? <Text style={uiStyles.muted}>Unsubscribed from your emails.</Text> : null}
      </Card>
      <Card title="History">
        <Row label="Orders" value={String(stats.orderCount)} />
        <Row label="Delivered" value={String(stats.deliveredCount)} />
        <Row label="Cancelled" value={String(stats.cancelledCount)} />
        <Row label="Returns" value={String(stats.returnsCount)} />
        <Row label="Spent" value={formatRupees(stats.totalSpent)} strong />
        <Row label="First order" value={formatDateTime(stats.firstOrderAt)} />
      </Card>
      {customer.note || customer.tags.length > 0 ? (
        <Card title="Your note">
          {customer.tags.length > 0 ? <Text style={uiStyles.muted}>{customer.tags.join(', ')}</Text> : null}
          {customer.note ? <Text style={uiStyles.body}>{customer.note}</Text> : null}
        </Card>
      ) : null}
      <Card title="Orders">
        {customer.orders.map((order) => (
          <View key={order.id}>
            <Button title={`${order.orderId} · ${statusLabel(order.status)} · ${formatRupees(order.total)}`} kind="secondary" onPress={() => onOpenOrder(order.id)} />
            <Text style={uiStyles.muted}>{formatDateTime(order.createdAt)}</Text>
          </View>
        ))}
      </Card>
      {customer.addresses.length > 0 ? (
        <Card title="Addresses">
          {customer.addresses.map((entry, index) => (
            <Text key={index} style={uiStyles.body}>
              {[entry.address, entry.city].filter(Boolean).join(', ')}
            </Text>
          ))}
        </Card>
      ) : null}
      <Text style={uiStyles.muted}>Notes, tags and blocking are changed on the website.</Text>
    </ScrollScreen>
  );
}
