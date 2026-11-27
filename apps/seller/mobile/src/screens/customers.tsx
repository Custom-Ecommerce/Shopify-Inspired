import type { MobileCustomer } from '@markaz/contracts/mobile-data';
import { Chip, colors, fontSize, formatDateTime, formatRupees, MIN_TAP_TARGET, radius, spacing, TextField, uiStyles, PagedList, usePagedList } from '@markaz/mobile-kit';
import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchCustomers } from '../api';
import { NotForYourRole, useCan } from '../components/can';
import { customerName, displayPhone } from '../labels';
import { useServices, useStoreChoice, useStoreKey } from '../services';

const SORTS = [
  { value: 'last_order', label: 'Latest order' },
  { value: 'total_spent', label: 'Spent most' },
  { value: 'orders', label: 'Most orders' },
] as const;

const CustomerRow = memo(function CustomerRow({ customer, onOpen }: { customer: MobileCustomer; onOpen: (key: string) => void }) {
  const name = customerName(customer.name, customer.phone, customer.email);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Customer ${name}`} onPress={() => onOpen(customer.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.name}>{formatRupees(customer.totalSpent)}</Text>
      </View>
      <Text style={styles.muted}>{[displayPhone(customer.phone), customer.email].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.muted}>
        {customer.orderCount} {customer.orderCount === 1 ? 'order' : 'orders'}, last {formatDateTime(customer.lastOrderAt)}
      </Text>
    </Pressable>
  );
});

export function CustomersScreen({ onOpenCustomer }: { onOpenCustomer: (key: string) => void }) {
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  const allowed = useCan('customers.read');
  const [sort, setSort] = useState<string>('last_order');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');

  const filters = { sort, q: search || undefined };
  const paged = usePagedList(key('customers', filters), (page) => fetchCustomers(runtime.client, storeId, filters, page), storeId !== '' && allowed);
  const renderItem = useCallback(({ item }: { item: MobileCustomer }) => <CustomerRow customer={item} onOpen={onOpenCustomer} />, [onOpenCustomer]);

  if (store && !allowed) return <NotForYourRole />;

  return (
    <PagedList
      paged={paged}
      renderItem={renderItem}
      empty={{ title: 'No customers here', text: search ? 'Nothing matches this search.' : 'Customers appear after their first order.' }}
      header={
        <>
          <TextField
            label="Search name, phone or email"
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              if (!text) setSearch('');
            }}
            onSubmitEditing={() => setSearch(typed.trim())}
            returnKeyType="search"
          />
          <View style={uiStyles.wrap}>
            {SORTS.map((option) => (
              <Chip key={option.value} label={option.label} selected={sort === option.value} onPress={() => setSort(option.value)} />
            ))}
          </View>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TAP_TARGET,
    gap: spacing.xs,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  name: { fontSize: fontSize.body, fontWeight: '700', color: colors.text, flexShrink: 1 },
  muted: { fontSize: fontSize.caption, color: colors.textMuted },
});
