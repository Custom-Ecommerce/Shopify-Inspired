import type { MobileProductListItem } from '@markaz/contracts/mobile-data';
import { AppText, formatRupees, ListRow, makeStyles, Package, StatusBadge, Thumb } from '@markaz/mobile-kit';
import { Image } from 'expo-image';
import { memo } from 'react';
import { View } from 'react-native';
import { sizedImageUrl } from '../image-url';
import { stockLabel } from '../labels';
import { StockBadge } from './badges';

export const THUMB = 56;

/** One product in a list: the photo (or a package icon), name, price, stock. Memoised, with a thumbnail the size it is shown at, kept on the phone. */
export const ProductRow = memo(function ProductRow({ product, onOpen }: { product: MobileProductListItem; onOpen: (id: string) => void }) {
  const styles = useStyles();
  const image = sizedImageUrl(product.imageUrl, THUMB * 3);
  return (
    <ListRow
      accessibilityLabel={`Product ${product.title}, ${formatRupees(product.minPrice)}, ${stockLabel(product.stockStatus)}`}
      onPress={() => onOpen(product.id)}
      leading={
        <Thumb size={THUMB} icon={Package}>
          {image ? <Image source={image} style={styles.image} contentFit="cover" cachePolicy="disk" recyclingKey={product.id} accessibilityIgnoresInvertColors /> : null}
        </Thumb>
      }
      title={product.title}
      footer={
        <>
          <AppText weight="semibold">{formatRupees(product.minPrice)}</AppText>
          <View style={styles.badges}>
            <StockBadge status={product.stockStatus} count={product.totalStock} />
            {product.status === 'draft' ? <StatusBadge label="Draft" tone="info" /> : null}
          </View>
        </>
      }
    />
  );
});

const useStyles = makeStyles((t) => ({
  image: { width: THUMB, height: THUMB },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs },
}));
