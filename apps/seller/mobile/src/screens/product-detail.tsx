import { mobileProductDetailSchema, type MobileProductDetail, type MobileVariant } from '@markaz/contracts/mobile-data';
import {
  AppText,
  Boxes,
  Button,
  Card,
  Clock,
  ErrorState,
  formatDateTime,
  formatRupees,
  LoadingState,
  makeStyles,
  NoConnection,
  Notice,
  OfflineBanner,
  Package,
  Row,
  ScrollScreen,
  StatusBadge,
  Tag,
  TextField,
  Thumb,
  useIsOnline,
} from '@markaz/mobile-kit';
import { ApiError, errorText, recordKey } from '@markaz/mobile-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { fetchProduct, setPrice, setStockCount } from '../api';
import { StockBadge } from '../components/badges';
import { NotForYourRole, useCan } from '../components/can';
import { sizedImageUrl } from '../image-url';
import { usePending, useSubmit } from '../offline';
import { useServices, useStoreChoice, useStoreKey } from '../services';
import { useActionKey } from '../use-action-key';
import { describeMine } from './pending';

const PHOTO = 120;
type Edit = { variantId: string; field: 'stock' | 'price'; value: string; compare: string };

/** A whole number of 0 or more, or null. */
const whole = (value: string): number | null => (/^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null);

export function ProductDetailScreen({ productId, onOpenPending }: { productId: string; onOpenPending?: () => void }) {
  const styles = useStyles();
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
        {photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {photos.map((media) => (
              <Image key={media.id} source={media.url} style={styles.photo} contentFit="cover" cachePolicy="disk" accessibilityLabel={media.alt ?? product.title} />
            ))}
          </ScrollView>
        ) : (
          <Thumb size={PHOTO} icon={Package} />
        )}
        <AppText accessibilityRole="header" variant="title">
          {product.title}
        </AppText>
        <View style={styles.badges}>
          <StatusBadge label={product.status === 'published' ? 'Published' : 'Draft'} tone={product.status === 'published' ? 'success' : 'info'} />
          <StockBadge status={product.stockStatus} />
        </View>
        <Row label="Stock" value={`${product.totalStock} in all`} />
        {product.description ? <AppText>{product.description}</AppText> : null}
        <AppText variant="caption" tone="muted">
          Photos, the description and new variants are changed on the website.
        </AppText>
      </Card>

      {problem ? <Notice tone="danger" text={problem} /> : null}
      {saved ? <Notice tone="success" text="Saved on this phone. It is sent when the connection is back." /> : null}
      {waiting.length > 0 && onOpenPending ? <Button title="Pending changes" kind="outline" icon={Clock} onPress={onOpenPending} /> : null}
      {canPrice && !online ? <Notice tone="info" text="Changing a price needs a connection." /> : null}

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
            {countWaiting ? <Notice tone="info" text={`Waiting to be sent: ${describeMine(countWaiting)}.`} /> : null}
            {!open ? (
              <View style={styles.actions}>
                {canCount && variant.trackQuantity && !countWaiting ? (
                  <Button title={`Count stock: ${name}`} kind="outline" icon={Boxes} onPress={() => setEdit({ variantId: variant.id, field: 'stock', value: '', compare: '' })} />
                ) : null}
                {canPrice ? (
                  <Button
                    title={`Change price: ${name}`}
                    kind="outline"
                    icon={Tag}
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
                  kind="ghost"
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

const useStyles = makeStyles((t) => ({
  photos: { gap: t.space.sm },
  photo: { width: PHOTO, height: PHOTO, borderRadius: t.radius.lg },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs },
  actions: { gap: t.space.sm },
}));
