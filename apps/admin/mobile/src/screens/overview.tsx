import {
  AppText,
  CalendarDays,
  Card,
  ErrorState,
  formatDateTime,
  formatRupees,
  LoadingState,
  NoConnection,
  Notice,
  RefreshCw,
  Row,
  ScrollScreen,
  Store,
  useIsOnline,
  Wallet,
} from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { fetchOverview } from '../api';
import { StaleLabel } from '../components/stale';
import { adminKey, useServices, useUserId } from '../services';

const PERIODS = [
  { key: 'today', title: 'Today' },
  { key: 'last7', title: 'Last 7 days' },
  { key: 'last30', title: 'Last 30 days' },
] as const;

export function OverviewScreen() {
  const { runtime } = useServices();
  const userId = useUserId();
  const online = useIsOnline();
  const overview = useQuery({ queryKey: adminKey(userId, 'overview'), queryFn: () => fetchOverview(runtime.client), enabled: userId !== '' });

  const data = overview.data;
  if (!data) {
    if (!online) return <NoConnection onRetry={() => void overview.refetch()} />;
    return overview.error ? <ErrorState message={errorText(overview.error)} onRetry={() => void overview.refetch()} /> : <LoadingState rows={4} />;
  }

  const kpi = data.kpi;
  return (
    <ScrollScreen refreshing={overview.isRefetching} onRefresh={() => void overview.refetch()}>
      <StaleLabel updatedAt={overview.dataUpdatedAt} error={overview.error} />

      {!kpi ? <Notice tone="info" text="Sales numbers are not available right now." /> : null}
      {kpi
        ? PERIODS.map(({ key, title }) => {
            const period = kpi.periods[key];
            return (
              <Card key={key} title={title} icon={CalendarDays}>
                <Row label="Orders" value={String(kpi.ordersByPeriod[key])} />
                <Row label="Online sales" value={`${formatRupees(period.gatewaySales)} (${period.gatewayOrders})`} />
                <Row label="Cash on delivery" value={`${formatRupees(period.codOrderValue)} (${period.codOrders})`} />
                <Row label="Commission" value={formatRupees(period.commission)} strong />
                {period.codCommission !== undefined ? <Row label="of which on COD" value={formatRupees(period.codCommission)} /> : null}
              </Card>
            );
          })
        : null}
      {kpi ? (
        <Card title="Payouts" icon={Wallet}>
          <Row label="Not yet settled to sellers" value={formatRupees(kpi.unsettledBalance)} />
        </Card>
      ) : null}

      <Card title="Sellers and stores" icon={Store}>
        <Row label={`New sellers (${data.sellers.windowDays} days)`} value={String(data.sellers.newInWindow)} strong />
        <Row label="Sellers" value={String(data.sellers.total)} />
        <Row label="Active stores" value={String(data.stores.byStatus.active)} />
        <Row label="Stores waiting" value={String(data.stores.byStatus.pending)} />
        <Row label="Suspended stores" value={String(data.stores.byStatus.suspended)} />
      </Card>

      <Card title="Sync" icon={RefreshCw}>
        <Row label="Waiting" value={String(data.outbox.counts.pending)} />
        <Row label="Failed" value={String(data.outbox.counts.dead)} />
      </Card>
      <AppText variant="caption" tone="muted">Numbers of {formatDateTime(data.generatedAt)}</AppText>
    </ScrollScreen>
  );
}
