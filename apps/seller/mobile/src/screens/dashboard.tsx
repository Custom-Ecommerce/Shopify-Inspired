import { sellerCan } from '@markaz/auth/seller-capabilities';
import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fontSize,
  formatDateTime,
  formatRupees,
  LoadingState,
  NoConnection,
  OfflineBanner,
  MIN_TAP_TARGET,
  Notice,
  radius,
  ScrollScreen,
  spacing,
  uiStyles,
  useIsOnline,
} from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchDashboard, fetchUnreadAlerts } from '../api';
import { OrderRow } from '../components/order-row';
import { QueueNotice } from '../components/queue-notice';
import { roleLabel } from '../labels';
import { markFirstScreen } from '../perf';
import { useServices, useStoreChoice, useStoreKey } from '../services';

export interface DashboardProps {
  onOpenOrder: (id: string) => void;
  onOpenOrders: (filter?: { status?: string }) => void;
  onSwitchStore: () => void;
  onOpenLowStock: () => void;
  onOpenAlerts: () => void;
  onOpenPending: () => void;
}

function Tile({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const body = (
    <>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.tile}>
        {body}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

export function DashboardScreen(props: DashboardProps) {
  const { runtime } = useServices();
  const signOut = () => void runtime.session.signOut();
  const choice = useStoreChoice();
  const store = choice.store;
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  // Every role reads orders; a store whose role cannot is shown as such by the server (403).
  const numbers = useQuery({ queryKey: key('dashboard'), queryFn: () => fetchDashboard(runtime.client, storeId), enabled: storeId !== '' });
  const alerts = useQuery({
    queryKey: key('alerts', 'unread'),
    queryFn: () => fetchUnreadAlerts(runtime.client, storeId),
    enabled: storeId !== '' && sellerCan(store?.role, 'alerts.read'),
  });

  const online = useIsOnline();
  const shown = numbers.data !== undefined;
  useEffect(() => {
    if (shown) markFirstScreen();
  }, [shown]);

  if (!store) {
    if (!online && choice.stores.length === 0) return <NoConnection onRetry={choice.reload} />;
    if (choice.loading && !choice.error) return <LoadingState />;
    return (
      <ScrollScreen onRefresh={choice.reload}>
        {choice.error ? (
          <ErrorState message={errorText(choice.error)} onRetry={choice.reload} />
        ) : (
          <EmptyState title="No store yet" text="Create your store on the website, or ask the owner to invite you." />
        )}
        <Button title="Sign out" kind="secondary" onPress={signOut} />
      </ScrollScreen>
    );
  }

  const data = numbers.data;
  const refresh = () => {
    void numbers.refetch();
    void alerts.refetch();
    choice.reload();
  };

  return (
    <ScrollScreen refreshing={numbers.isRefetching} onRefresh={refresh}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Store ${store.name}, change store`} onPress={props.onSwitchStore} style={styles.store}>
        <View style={styles.storeText}>
          <Text style={uiStyles.title} numberOfLines={1}>
            {store.name}
          </Text>
          <Text style={uiStyles.muted}>Your role: {roleLabel(store.role)}</Text>
        </View>
        <Text style={styles.change}>Change</Text>
      </Pressable>

      <OfflineBanner updatedAt={data ? numbers.dataUpdatedAt : undefined} />
      <QueueNotice onOpen={props.onOpenPending} />
      {online && numbers.error && data ? <Notice text={`Showing saved numbers from ${formatDateTime(numbers.dataUpdatedAt)}. ${errorText(numbers.error)}`} /> : null}

      {!data ? (
        !online ? (
          <NoConnection onRetry={refresh} />
        ) : numbers.error ? (
          <ErrorState message={errorText(numbers.error)} onRetry={refresh} />
        ) : (
          <LoadingState />
        )
      ) : (
        <>
          <View style={styles.grid}>
            {data.salesToday !== null && data.salesToday !== undefined ? <Tile label="Sales today" value={formatRupees(data.salesToday)} /> : null}
            {data.salesThisWeek !== null && data.salesThisWeek !== undefined ? <Tile label="Sales in 7 days" value={formatRupees(data.salesThisWeek)} /> : null}
            <Tile label="Orders today" value={String(data.ordersToday)} onPress={() => props.onOpenOrders()} />
            <Tile label="Pending orders" value={String(data.pendingOrders)} onPress={() => props.onOpenOrders({ status: 'pending' })} />
            <Tile label="To confirm by phone" value={String(data.unconfirmedOrders)} />
            {data.lowStockProducts !== null ? <Tile label="Low stock products" value={String(data.lowStockProducts)} onPress={props.onOpenLowStock} /> : null}
            {alerts.data !== undefined ? <Tile label="Unread alerts" value={String(alerts.data)} onPress={props.onOpenAlerts} /> : null}
            {data.revenueThisMonth !== null ? <Tile label="Delivered this month" value={formatRupees(data.revenueThisMonth)} /> : null}
          </View>

          <Card title="Recent orders">
            {data.recentOrders.length === 0 ? (
              <EmptyState title="No orders yet" text="Your first order will appear here." />
            ) : (
              data.recentOrders.map((order) => <OrderRow key={order.id} order={order} onOpen={props.onOpenOrder} />)
            )}
          </Card>
          <Text style={uiStyles.muted}>Updated {formatDateTime(numbers.dataUpdatedAt)}</Text>
        </>
      )}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  store: { minHeight: MIN_TAP_TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  storeText: { flex: 1 },
  change: { fontSize: fontSize.body, color: colors.primary, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 76,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  tileValue: { fontSize: fontSize.heading, fontWeight: '700', color: colors.text },
  tileLabel: { fontSize: fontSize.caption, color: colors.textMuted },
});
