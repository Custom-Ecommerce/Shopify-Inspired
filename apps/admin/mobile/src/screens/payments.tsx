import type { AdminPayment } from '@markaz/contracts/subscription-payments';
import { EmptyState, ErrorState, formatDateTime, formatRupees, LoadingState, Notice, ScrollScreen, uiStyles, useIsOnline } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { Text } from 'react-native';
import { fetchPendingPayments } from '../api';
import { ListRow } from '../components/row';
import { METHOD_LABELS } from '../labels';
import { adminKey, useServices, useUserId } from '../services';

/** The claims waiting for a decision. Never shown from a cache: money is decided on what the server says now. */
export function usePendingPayments() {
  const { runtime } = useServices();
  const userId = useUserId();
  return useQuery({ queryKey: adminKey(userId, 'payments'), queryFn: () => fetchPendingPayments(runtime.client), enabled: userId !== '', staleTime: 0 });
}

export const OFFLINE_PAYMENTS = 'Payments need a connection. Nothing is saved or queued while offline.';

export function PaymentsScreen({ onOpenPayment }: { onOpenPayment: (id: string) => void }) {
  const online = useIsOnline();
  const payments = usePendingPayments();

  if (!online) return <ScrollScreen><Notice text={OFFLINE_PAYMENTS} /></ScrollScreen>;
  const data = payments.data;
  if (!data) return payments.error ? <ErrorState message={errorText(payments.error)} onRetry={() => void payments.refetch()} /> : <LoadingState />;

  return (
    <ScrollScreen refreshing={payments.isRefetching} onRefresh={() => void payments.refetch()}>
      {payments.error ? <Notice text={errorText(payments.error)} /> : null}
      <Text style={uiStyles.muted}>{data.pendingCount} waiting for a decision</Text>
      {data.docs.length === 0 ? <EmptyState title="Nothing is waiting" /> : null}
      {data.docs.map((payment: AdminPayment) => (
        <ListRow
          key={payment.id}
          id={payment.id}
          title={payment.seller.name}
          value={formatRupees(payment.amountRs)}
          lines={[
            `${payment.planName} · ${payment.method ? METHOD_LABELS[payment.method] : 'No method'}`,
            `Claimed ${formatDateTime(payment.claimedAt)}`,
          ]}
          onOpen={onOpenPayment}
        />
      ))}
    </ScrollScreen>
  );
}
