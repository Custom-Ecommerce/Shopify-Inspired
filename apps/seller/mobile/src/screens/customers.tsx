import type { MobileCustomer } from '@markaz/contracts/mobile-data';
import { AppText, Chip, Contact, formatDateTime, formatRupees, ListRow, PagedList, SearchField, usePagedList, Wrap } from '@markaz/mobile-kit';
import { memo, useCallback, useState } from 'react';
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
    <ListRow
      accessibilityLabel={`Customer ${name}`}
      onPress={() => onOpen(customer.id)}
      title={name}
      trailing={<AppText weight="semibold">{formatRupees(customer.totalSpent)}</AppText>}
      subtitle={[displayPhone(customer.phone), customer.email].filter(Boolean).join(' · ')}
      meta={`${customer.orderCount} ${customer.orderCount === 1 ? 'order' : 'orders'}, last ${formatDateTime(customer.lastOrderAt)}`}
    />
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
      empty={{ icon: Contact, title: 'No customers here', text: search ? 'Nothing matches this search.' : 'Customers appear after their first order.' }}
      header={
        <>
          <SearchField
            label="Search name, phone or email"
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              if (!text) setSearch('');
            }}
            onSubmit={() => setSearch(typed.trim())}
          />
          <Wrap>
            {SORTS.map((option) => (
              <Chip key={option.value} label={option.label} selected={sort === option.value} onPress={() => setSort(option.value)} />
            ))}
          </Wrap>
        </>
      }
    />
  );
}

