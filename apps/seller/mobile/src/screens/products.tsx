import type { MobileProductListItem } from '@markaz/contracts/mobile-data';
import { Chip, TextField, uiStyles, PagedList, usePagedList } from '@markaz/mobile-kit';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { fetchProducts, type ProductFilters } from '../api';
import { NotForYourRole, useCan } from '../components/can';
import { ProductRow } from '../components/product-row';
import { useServices, useStoreChoice, useStoreKey } from '../services';

const STATUSES: readonly { value: ProductFilters['status']; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
];

export interface ProductsProps {
  onOpenProduct: (id: string) => void;
  /** The dashboard's "Low stock" and a low stock notification open the list filtered. */
  initialLowStock?: boolean;
}

export function ProductsScreen({ onOpenProduct, initialLowStock = false }: ProductsProps) {
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  const allowed = useCan('products.read');
  const [status, setStatus] = useState<ProductFilters['status']>(undefined);
  const [low, setLow] = useState(initialLowStock);
  const [shownInitial, setShownInitial] = useState(initialLowStock);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  if (initialLowStock !== shownInitial) {
    setShownInitial(initialLowStock);
    if (initialLowStock) setLow(true);
  }

  const filters: ProductFilters = { status, stock: low ? 'low' : undefined, q: search || undefined };
  const paged = usePagedList(key('products', filters), (page) => fetchProducts(runtime.client, storeId, filters, page), storeId !== '' && allowed);
  const renderItem = useCallback(({ item }: { item: MobileProductListItem }) => <ProductRow product={item} onOpen={onOpenProduct} />, [onOpenProduct]);

  if (store && !allowed) return <NotForYourRole />;

  return (
    <PagedList
      paged={paged}
      renderItem={renderItem}
      empty={{ title: 'No products here', text: status || low || search ? 'Nothing matches these filters.' : 'Add your first product on the website.' }}
      header={
        <>
          <TextField
            label="Search products"
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              if (!text) setSearch('');
            }}
            onSubmitEditing={() => setSearch(typed.trim())}
            returnKeyType="search"
          />
          <View style={uiStyles.wrap}>
            {STATUSES.map((option) => (
              <Chip key={option.label} label={option.label} selected={status === option.value} onPress={() => setStatus(option.value)} />
            ))}
            <Chip label="Low stock" selected={low} onPress={() => setLow((value) => !value)} />
          </View>
          <Text style={uiStyles.muted}>New products and photos are added on the website.</Text>
        </>
      }
    />
  );
}
