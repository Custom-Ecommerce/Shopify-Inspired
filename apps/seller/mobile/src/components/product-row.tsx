import type { MobileProductListItem } from '@markaz/contracts/mobile-data';
import { colors, fontSize, formatRupees, MIN_TAP_TARGET, radius, spacing } from '@markaz/mobile-kit';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { sizedImageUrl } from '../image-url';
import { stockLabel } from '../labels';

export const THUMB = 56;

/** One product in a list. Memoised, with a thumbnail the size it is shown at, kept on the phone. */
export const ProductRow = memo(function ProductRow({ product, onOpen }: { product: MobileProductListItem; onOpen: (id: string) => void }) {
  const image = sizedImageUrl(product.imageUrl, THUMB * 3);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Product ${product.title}, ${formatRupees(product.minPrice)}, ${stockLabel(product.stockStatus)}`}
      onPress={() => onOpen(product.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {image ? (
        <Image source={image} style={styles.thumb} contentFit="cover" cachePolicy="disk" recyclingKey={product.id} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.noImage]} />
      )}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>
          {product.title}
        </Text>
        <Text style={styles.muted}>
          {formatRupees(product.minPrice)}
          {product.status === 'draft' ? ' · Draft' : ''}
        </Text>
        <Text style={[styles.muted, product.stockStatus !== 'in_stock' && styles.warning]}>
          {stockLabel(product.stockStatus)} · {product.totalStock} in stock
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TAP_TARGET,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm },
  noImage: { backgroundColor: colors.border },
  text: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.body, fontWeight: '600', color: colors.text },
  muted: { fontSize: fontSize.caption, color: colors.textMuted },
  warning: { color: colors.warning },
});
