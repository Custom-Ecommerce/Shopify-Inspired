import { formatDateTime, PagedList, TextField, uiStyles, usePagedList } from '@markaz/mobile-kit';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { fetchSellers, type SellerRow } from '../api';
import { ListRow } from '../components/row';
import { label } from '../labels';
import { adminKey, useServices, useUserId } from '../services';

/** Read only: suspending and limits stay on the console. */
export function SellersScreen() {
  const { runtime } = useServices();
  const userId = useUserId();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const paged = usePagedList(adminKey(userId, 'sellers', search), (page) => fetchSellers(runtime.client, search || undefined, page), userId !== '');

  const renderItem = useCallback(
    ({ item }: { item: SellerRow }) => (
      <ListRow
        id={item.id}
        title={item.name || item.email}
        value={label(item.accountStatus)}
        lines={[
          item.email,
          `${item.storeCount} ${item.storeCount === 1 ? 'store' : 'stores'}${item.stores.length ? `: ${item.stores.map((store) => `${store.name} (${store.status})`).join(', ')}` : ''}`,
          `Joined ${formatDateTime(item.createdAt)}`,
        ]}
      />
    ),
    [],
  );

  return (
    <PagedList
      paged={paged}
      renderItem={renderItem}
      empty={{ title: 'No sellers here' }}
      header={
        <>
          <TextField
            label="Search name or email"
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              if (!text) setSearch('');
            }}
            onSubmitEditing={() => setSearch(typed.trim())}
            returnKeyType="search"
            autoCapitalize="none"
          />
          <Text style={uiStyles.muted}>Read only. Change a seller on the console.</Text>
        </>
      }
    />
  );
}
