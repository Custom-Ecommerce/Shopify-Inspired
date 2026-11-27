import { mobileProductDetailSchema, type MobileProductDetail, type MobileVariant } from '@markaz/contracts/mobile-data';
import {
  Button,
  Card,
  ErrorState,
  formatDateTime,
  formatRupees,
  LoadingState,
  NoConnection,
  Notice,
  OfflineBanner,
  radius,
  Row,
  ScrollScreen,
  spacing,
  TextField,
  uiStyles,
  useIsOnline,
} from '@markaz/mobile-kit';
import { ApiError, errorText, recordKey } from '@markaz/mobile-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchProduct, setPrice, setStockCount } from '../api';
import { NotForYourRole, useCan } from '../components/can';
import { sizedImageUrl } from '../image-url';
import { stockLabel } from '../labels';
import { usePending, useSubmit } from '../offline';
import { useServices, useStoreChoice, useStoreKey } from '../services';
import { useActionKey } from '../use-action-key';
import { describeMine } from './pending';

const PHOTO = 120;
type Edit = { variantId: string; field: 'stock' | 'price'; value: string; compare: string };

/** A whole number of 0 or more, or null. */
const whole = (value: string): number | null => (/^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null);

export function ProductDetailScreen({ productId, onOpenPending }: { productId: string; onOpenPending?: () => void }) {
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  const queryClient = useQueryClient();
  const canRead = useCan('products.read');
  const canPrice = useCan('products.write');
  const canCount = useCan('inventory.write');
  const detail = useQuery({ queryKey: key('product', productId), queryFn: () => fetchProduct(runtime.client, storeId, productId), enabled: storeId !== '' && canRead });

  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const action = useActionKey();
  const submit = useSubmit();
  const online = useIsOnline();
  const [saved, setSaved] = useState(false);
  const waiting = usePending((entry) => entry.storeId === storeId && recordKey(entry.change) === `product:${productId}`);

  if (store && !canRead) return <NotForYourRole />;
  const product = detail.data;
  if (!product && !online) return <NoConnection onRetry={() => void detail.refetch()} />;
  if (!product) return detail.error ? <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} /> : <LoadingState rows={4} />;

  const show = (next: MobileProductDetail) => {
    queryClient.setQueryData(key('product', productId), next);
    void queryClient.invalidateQueries({ queryKey: key('products') });
    void queryClient.invalidateQueries({ queryKey: key('dashboard') });
  };

  async function save(current: MobileProductDetail, variant: MobileVariant, change: Edit) {
    const value = whole(change.value);
    if (value === null) {
      setProblem(change.field === 'stock' ? 'Enter the count as a whole number.' : 'Enter the price in whole rupees.');
      return;
    }
    const compare = change.compare.trim() === '' ? null : whole(change.compare);
    if (change.field === 'price' && change.compare.trim() !== '' && compare === null) {
      setProblem('Enter the old price in whole rupees, or leave it empty.');
      return;
    }
    const revision = current.revision;
    const idempotencyKey = action.keyFor({ productId, revision, variantId: variant.id, field: change.field, value, compare });
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      if (change.field === 'stock') {
        const outcome = await submit({
          change: {
            storeId,
            change: { kind: 'stock.count', productId, variantId: variant.id, quantity: value },
            revision,
            label: `${current.title}${variant.title === 'Default' ? '' : ` ${variant.title}`}: stock count`,
            seen: { quantity: variant.stockQuantity },
          },
          send: (key) => setStockCount(runtime.client, storeId, productId, revision, variant.id, value, key),
        });
        if (outcome.kind === 'sent') show(outcome.answer.product);
        else setSaved(true);
      } else {
        const answer = await setPrice(runtime.client, storeId, productId, revision, { variantId: variant.id, price: value, compareAtPrice: compare }, idempotencyKey);
        show(answer.product);
      }
      action.done();
      setEdit(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        action.done();
        const latest = mobileProductDetailSchema.safeParse((error.body as { current?: unknown } | null)?.current);
        if (latest.success) {
          show(latest.data);
          const now = latest.data.variants.find((entry) => entry.id === variant.id);
          const server = now ? (change.field === 'stock' ? `${now.stockQuantity} in stock` : formatRupees(now.price)) : 'no such variant';
          setProblem(`This product changed on the server (now ${server}). Your ${change.field === 'stock' ? `count ${value}` : `price ${formatRupees(value)}`} was not saved. Check and save again if it is still right.`);
        } else {
          void detail.refetch();
          setProblem('This product changed on the server. Check it and try again.');
        }
      } else {
        if (error instanceof ApiError && error.status < 500) action.done();
        setProblem(errorText(error));
      }
    } finally {
      setBusy(false);
    }
  }

  const photos = product.media.map((media) => ({ id: media.id, url: sizedImageUrl(media.url, PHOTO * 3), alt: media.alt })).filter((media) => media.url);

  return (
    <ScrollScreen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
      <OfflineBanner updatedAt={detail.dataUpdatedAt} />
      {online && detail.error ? <Notice text={`Showing the product saved at ${formatDateTime(detail.dataUpdatedAt)}. ${errorText(detail.error)}`} /> : null}
      <Card>
        <Text accessibilityRole="header" style={uiStyles.title}>
          {product.title}
        </Text>
        <Row label="Status" value={product.status === 'published' ? 'Published' : 'Draft'} />
        <Row label="Stock" value={`${stockLabel(product.stockStatus)}, ${product.totalStock} in all`} />
        {photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {photos.map((media) => (
              <Image key={media.id} source={media.url} style={styles.photo} contentFit="cover" cachePolicy="disk" accessibilityLabel={media.alt ?? product.title} />
            ))}
          </ScrollView>
        ) : null}
        {product.description ? <Text style={uiStyles.body}>{product.description}</Text> : null}
        <Text style={uiStyles.muted}>Photos, the description and new variants are changed on the website.</Text>
      </Card>

      {problem ? <Notice tone="danger" text={problem} /> : null}
      {saved ? <Notice text="Saved on this phone. It is sent when the connection is back." /> : null}
      {waiting.length > 0 && onOpenPending ? <Button title="Pending changes" kind="secondary" onPress={onOpenPending} /> : null}
      {canPrice && !online ? <Notice text="Changing a price needs a connection." /> : null}

      {product.variants.map((variant) => {
        const open = edit?.variantId === variant.id ? edit : null;
        const name = variant.title === 'Default' ? product.title : variant.title;
        const countWaiting = waiting.find((entry) => entry.change.kind === 'stock.count' && entry.change.variantId === variant.id);
        return (
          <Card key={variant.id} title={variant.title === 'Default' ? 'Price and stock' : variant.title}>
            <Row label="Price" value={formatRupees(variant.price)} strong />
            {variant.compareAtPrice ? <Row label="Old price" value={formatRupees(variant.compareAtPrice)} /> : null}
            <Row label="Stock" value={variant.trackQuantity ? String(variant.stockQuantity) : 'Not counted'} />
            {variant.sku ? <Row label="SKU" value={variant.sku} /> : null}
            {countWaiting ? <Notice text={`Waiting to be sent: ${describeMine(countWaiting)}.`} /> : null}
            {!open ? (
              <View style={uiStyles.wrap}>
                {canCount && variant.trackQuantity && !countWaiting ? (
                  <Button title={`Count stock: ${name}`} kind="secondary" onPress={() => setEdit({ variantId: variant.id, field: 'stock', value: '', compare: '' })} />
                ) : null}
                {canPrice ? (
                  <Button
                    title={`Change price: ${name}`}
                    kind="secondary"
                    onPress={() => setEdit({ variantId: variant.id, field: 'price', value: String(variant.price), compare: variant.compareAtPrice ? String(variant.compareAtPrice) : '' })}
                    // A price needs the server now; a waiting count of this product must go first.
                    disabled={!online || waiting.length > 0}
                  />
                ) : null}
              </View>
            ) : (
              <>
                <TextField
                  label={open.field === 'stock' ? 'Count on the shelf now' : 'New price (Rs)'}
                  value={open.value}
                  onChangeText={(value) => setEdit({ ...open, value })}
                  keyboardType="number-pad"
                  autoFocus
                />
                {open.field === 'price' ? (
                  <TextField label="Old price, shown struck out (optional)" value={open.compare} onChangeText={(compare) => setEdit({ ...open, compare })} keyboardType="number-pad" />
                ) : null}
                <Button title={open.field === 'stock' ? 'Save count' : 'Save price'} onPress={() => void save(product, variant, open)} busy={busy} disabled={open.field === 'price' && !online} />
                <Button
                  title="Cancel"
                  kind="secondary"
                  onPress={() => {
                    setEdit(null);
                    setProblem(null);
                  }}
                  disabled={busy}
                />
              </>
            )}
          </Card>
        );
      })}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  photos: { gap: spacing.sm },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radius.md },
});
