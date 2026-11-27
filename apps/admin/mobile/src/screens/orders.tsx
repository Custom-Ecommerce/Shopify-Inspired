import { ADMIN_ORDER_STATUSES, type AdminOrderRow } from '@markaz/contracts/admin-orders';
import { Chip, formatDateTime, formatRupees, PagedList, spacing, TextField, uiStyles, usePagedList } from '@markaz/mobile-kit';
import { useCallback, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { fetchOrders } from '../api';
import { ListRow } from '../components/row';
import { label } from '../labels';
import { adminKey, useServices, useUserId } from '../services';

/** Every store's orders, read only. The server sends no name, phone, address or email of a shopper. */
export function OrdersScreen({ onOpenOrder }: { onOpenOrder: (id: string) => void }) {
  const { runtime } = useServices();
  const userId = useUserId();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const filters = { status, q: search || undefined };
  const paged = usePagedList(adminKey(userId, 'orders', filters), (page) => fetchOrders(runtime.client, filters, page), userId !== '');

  const renderItem = useCallback(
    ({ item }: { item: AdminOrderRow }) => (
      <ListRow
        id={item.id}
        title={item.orderNumber}
        value={formatRupees(item.total)}
        lines={[`${item.storeName ?? 'Unknown store'} · ${label(item.status)}`, `${item.paymentMethod === 'card' ? 'Card' : 'COD'} · ${formatDateTime(item.createdAt)}`]}
        onOpen={onOpenOrder}
      />
    ),
    [onOpenOrder],
  );

  return (
    <PagedList
      paged={paged}
      renderItem={renderItem}
      empty={{ title: 'No orders here' }}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            <Chip label="All" selected={!status} onPress={() => setStatus(undefined)} />
            {ADMIN_ORDER_STATUSES.map((value) => (
              <Chip key={value} label={label(value)} selected={status === value} onPress={() => setStatus(value)} />
            ))}
          </ScrollView>
          <Text style={uiStyles.muted}>Read only. Shoppers&apos; contact details are never shown.</Text>
        </>
      }
    />
  );
}
