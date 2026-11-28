import { sellerCan } from '@markaz/auth/seller-capabilities';
import {
  AlertTriangle,
  AppText,
  Banknote,
  Bell,
  Boxes,
  Button,
  Clock,
  EmptyState,
  ErrorState,
  formatDateTime,
  formatRupees,
  LoadingState,
  LogOut,
  makeStyles,
  NoConnection,
  Notice,
  OfflineBanner,
  PackageCheck,
  PhoneCall,
  ScrollScreen,
  SectionHeader,
  ShoppingCart,
  StatCard,
  Store,
  TrendingUp,
  useIsOnline,
  useSessionState,
} from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { View } from 'react-native';
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

/** "Good morning" by the phone's clock. */
export function greeting(name: string | null | undefined, now: Date = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

export function DashboardScreen(props: DashboardProps) {
  const styles = useStyles();
  const { runtime } = useServices();
  const user = useSessionState(runtime).user;
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
          <EmptyState icon={Store} title="No store yet" text="Create your store on the website, or ask the owner to invite you." />
        )}
        <Button title="Sign out" kind="outline" icon={LogOut} onPress={signOut} />
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
      <View style={styles.greeting}>
        <AppText variant="title" weight="semibold">
          {greeting(user?.name)}
        </AppText>
        <AppText variant="caption" tone="muted">
          Your role: {roleLabel(store.role)}
        </AppText>
      </View>

      <OfflineBanner updatedAt={data ? numbers.dataUpdatedAt : undefined} />
      <QueueNotice onOpen={props.onOpenPending} />
      {online && numbers.error && data ? <Notice text={`Showing saved numbers from ${formatDateTime(numbers.dataUpdatedAt)}. ${errorText(numbers.error)}`} /> : null}

      {!data ? (
        !online ? (
          <NoConnection onRetry={refresh} />
        ) : numbers.error ? (
          <ErrorState message={errorText(numbers.error)} onRetry={refresh} />
        ) : (
          <LoadingState rows={4} />
        )
      ) : (
        <>
          <View style={styles.grid}>
            {data.salesToday !== null && data.salesToday !== undefined ? <StatCard icon={Banknote} label="Sales today" value={formatRupees(data.salesToday)} tone="success" /> : null}
            {data.salesThisWeek !== null && data.salesThisWeek !== undefined ? <StatCard icon={TrendingUp} label="Sales in 7 days" value={formatRupees(data.salesThisWeek)} /> : null}
            <StatCard icon={ShoppingCart} label="Orders today" value={String(data.ordersToday)} onPress={() => props.onOpenOrders()} />
            <StatCard icon={Clock} label="Pending orders" value={String(data.pendingOrders)} tone={data.pendingOrders > 0 ? 'warning' : undefined} onPress={() => props.onOpenOrders({ status: 'pending' })} />
            <StatCard icon={PhoneCall} label="To confirm by phone" value={String(data.unconfirmedOrders)} tone={data.unconfirmedOrders > 0 ? 'warning' : undefined} />
            {data.lowStockProducts !== null ? (
              <StatCard icon={data.lowStockProducts > 0 ? AlertTriangle : Boxes} label="Low stock products" value={String(data.lowStockProducts)} tone={data.lowStockProducts > 0 ? 'warning' : undefined} onPress={props.onOpenLowStock} />
            ) : null}
            {alerts.data !== undefined ? <StatCard icon={Bell} label="Unread alerts" value={String(alerts.data)} tone={alerts.data > 0 ? 'info' : undefined} onPress={props.onOpenAlerts} /> : null}
            {data.revenueThisMonth !== null ? <StatCard icon={PackageCheck} label="Delivered this month" value={formatRupees(data.revenueThisMonth)} tone="success" /> : null}
          </View>

          <SectionHeader title="Recent orders" />
          {data.recentOrders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No orders yet" text="Your first order will appear here." />
          ) : (
            <View>
              {data.recentOrders.map((order) => (
                <OrderRow key={order.id} order={order} onOpen={props.onOpenOrder} />
              ))}
            </View>
          )}
          <View style={styles.updated}>
            <AppText variant="caption" tone="muted">
              Updated {formatDateTime(numbers.dataUpdatedAt)}
            </AppText>
          </View>
        </>
      )}
    </ScrollScreen>
  );
}

const useStyles = makeStyles((t) => ({
  greeting: { gap: t.space.xxs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  updated: { flexDirection: 'row', justifyContent: 'center', gap: t.space.xs },
}));
