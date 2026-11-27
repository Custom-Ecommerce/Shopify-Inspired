import type { MobileOrderListItem } from '@markaz/contracts/mobile-data';
import { colors, fontSize, formatDateTime, formatRupees, MIN_TAP_TARGET, radius, spacing } from '@markaz/mobile-kit';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { statusLabel } from '../labels';

/** One order in a list. Memoised: it renders again only when its order changes. */
export const OrderRow = memo(function OrderRow({ order, onOpen, waiting = false }: { order: MobileOrderListItem; onOpen: (id: string) => void; waiting?: boolean }) {
  const unconfirmed = order.confirmationStatus === 'unconfirmed' && order.status !== 'cancelled';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderId}, ${statusLabel(order.status)}, ${formatRupees(order.total)}`}
      onPress={() => onOpen(order.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.line}>
        <Text style={styles.number}>{order.orderId}</Text>
        <Text style={styles.total}>{formatRupees(order.total)}</Text>
      </View>
      <View style={styles.line}>
        <Text style={styles.muted} numberOfLines={1}>
          {[order.customerName, order.city].filter(Boolean).join(', ') || 'No name'}
        </Text>
        <Text style={styles.status}>{statusLabel(order.status)}</Text>
      </View>
      <View style={styles.line}>
        <Text style={styles.muted}>{formatDateTime(order.createdAt)}</Text>
        <Text style={styles.muted}>{order.paymentMethod === 'card' ? 'Card' : 'COD'}</Text>
      </View>
      {unconfirmed ? <Text style={styles.warning}>Waiting for your confirmation call</Text> : null}
      {waiting ? <Text style={styles.warning}>A change is waiting to be sent</Text> : null}
    </Pressable>
  );
});

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
  number: { fontSize: fontSize.body, fontWeight: '700', color: colors.text, flexShrink: 1 },
  total: { fontSize: fontSize.body, fontWeight: '700', color: colors.text },
  status: { fontSize: fontSize.caption, fontWeight: '600', color: colors.primary },
  muted: { fontSize: fontSize.caption, color: colors.textMuted, flexShrink: 1 },
  warning: { fontSize: fontSize.caption, color: colors.warning },
});
