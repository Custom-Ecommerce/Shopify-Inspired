import { DASHBOARD_ORDER_STATUSES } from '@markaz/contracts/order';
import type { MobileOrderListItem, MobileOrderPaymentFilter } from '@markaz/contracts/mobile-data';
import { Chip, spacing, TextField, uiStyles, PagedList, usePagedList } from '@markaz/mobile-kit';
import { recordKey } from '@markaz/mobile-kit/core';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fetchOrders, type OrderFilters } from '../api';
import { OrderRow } from '../components/order-row';
import { statusLabel } from '../labels';
import { usePending } from '../offline';
import { useServices, useStoreChoice, useStoreKey } from '../services';

export interface OrdersProps {
  onOpenOrder: (id: string) => void;
  /** The filter the screen opens with (the dashboard's "Pending orders"). */
  initialStatus?: string;
}

const PAYMENTS: readonly { value: MobileOrderPaymentFilter | undefined; label: string }[] = [
  { value: undefined, label: 'All payments' },
  { value: 'cod', label: 'COD' },
  { value: 'paid', label: 'Paid' },
];

export function OrdersScreen({ onOpenOrder, initialStatus }: OrdersProps) {
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [shownInitial, setShownInitial] = useState(initialStatus);
  const [payment, setPayment] = useState<MobileOrderPaymentFilter | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');

  // A new filter from the dashboard replaces the one picked here.
  if (initialStatus !== shownInitial) {
    setShownInitial(initialStatus);
    setStatus(initialStatus);
  }

  const filters = useMemo<OrderFilters>(() => ({ status, payment, q: search || undefined }), [status, payment, search]);
  const paged = usePagedList(key('orders', filters), (page) => fetchOrders(runtime.client, storeId, filters, page), storeId !== '');
  const counts = paged.list.data?.pages[0]?.counts;

  const changes = usePending();
  const waiting = useMemo(() => new Set(changes.filter((change) => change.storeId === storeId).map((change) => recordKey(change.change))), [changes, storeId]);

  const renderItem = useCallback(
    ({ item }: { item: MobileOrderListItem }) => <OrderRow order={item} onOpen={onOpenOrder} waiting={waiting.has(`order:${item.id}`)} />,
    [onOpenOrder, waiting],
  );

  return (
    <PagedList
      paged={paged}
      renderItem={renderItem}
      empty={{ title: 'No orders here', text: status || payment || search ? 'Nothing matches these filters.' : 'Your first order will appear here.' }}
      header={
        <>
          <TextField
            label="Search by order number"
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              if (!text) setSearch('');
            }}
            onSubmitEditing={() => setSearch(typed.trim())}
            returnKeyType="search"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label={counts ? `All (${counts.all})` : 'All'} selected={!status} onPress={() => setStatus(undefined)} />
            {DASHBOARD_ORDER_STATUSES.map((value) => (
              <Chip
                key={value}
                label={counts ? `${statusLabel(value)} (${counts[value]})` : statusLabel(value)}
                selected={status === value}
                onPress={() => setStatus(value)}
              />
            ))}
          </ScrollView>
          <View style={uiStyles.wrap}>
            {PAYMENTS.map((option) => (
              <Chip key={option.label} label={option.label} selected={payment === option.value} onPress={() => setPayment(option.value)} />
            ))}
          </View>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm },
});
