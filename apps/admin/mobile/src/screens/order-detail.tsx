import { Card, ErrorState, formatDateTime, formatRupees, LoadingState, NoConnection, Row, ScrollScreen, uiStyles, useIsOnline } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { Text } from 'react-native';
import { fetchOrder } from '../api';
import { StaleLabel } from '../components/stale';
import { label } from '../labels';
import { adminKey, useServices, useUserId } from '../services';

/** One order, read only. Opening it is audited by the server, with this phone's device. */
export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const { runtime } = useServices();
  const userId = useUserId();
  const online = useIsOnline();
  const detail = useQuery({ queryKey: adminKey(userId, 'order', orderId), queryFn: () => fetchOrder(runtime.client, orderId), enabled: userId !== '' });

  const order = detail.data;
  if (!order) {
    if (!online) return <NoConnection onRetry={() => void detail.refetch()} />;
    return detail.error ? <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} /> : <LoadingState rows={4} />;
  }

  const { totals } = order;
  const tax = totals.tax ? `${totals.taxLabel || 'Tax'}${totals.taxIncluded ? ' (included in prices)' : ''}` : null;
  return (
    <ScrollScreen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
      <StaleLabel updatedAt={detail.dataUpdatedAt} error={detail.error} />
      <Card>
        <Text accessibilityRole="header" style={uiStyles.title}>
          {order.orderNumber}
        </Text>
        <Row label="Store" value={order.storeName ?? '-'} />
        <Row label="Status" value={label(order.status)} strong />
        <Row label="Payment" value={`${order.paymentMethod === 'card' ? 'Card' : 'Cash on delivery'}, ${label(order.paymentStatus).toLowerCase()}`} />
        <Row label="Phone confirmation" value={label(order.confirmationStatus)} />
        {order.city ? <Row label="City" value={order.city} /> : null}
        <Row label="Placed" value={formatDateTime(order.createdAt)} />
      </Card>
      <Card title="Items">
        {order.items.map((item, index) => (
          <Row key={index} label={`${item.quantity} x ${item.name}`} value={formatRupees(item.lineTotal)} />
        ))}
        <Row label="Subtotal" value={formatRupees(totals.subtotal)} />
        {totals.discount > 0 ? <Row label="Discount" value={`- ${formatRupees(totals.discount)}`} /> : null}
        <Row label="Delivery" value={formatRupees(totals.delivery)} />
        {tax ? <Row label={tax} value={formatRupees(totals.tax)} /> : null}
        <Row label="Total" value={formatRupees(totals.total)} strong />
      </Card>
      <Card title="History">
        {order.statusHistory.length === 0 ? <Text style={uiStyles.muted}>No status change yet.</Text> : null}
        {order.statusHistory.map((entry, index) => (
          <Row key={index} label={`${label(entry.from)} to ${label(entry.to)}`} value={formatDateTime(entry.at)} />
        ))}
      </Card>
    </ScrollScreen>
  );
}
