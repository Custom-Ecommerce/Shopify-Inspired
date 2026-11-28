import type { MobileOrderListItem } from '@markaz/contracts/mobile-data';
import { AppText, formatDateTime, formatRupees, ListRow, makeStyles, PhoneCall, RefreshCw, Icon } from '@markaz/mobile-kit';
import { memo } from 'react';
import { View } from 'react-native';
import { statusLabel } from '../labels';
import { OrderStatusBadge, PaymentBadge } from './badges';

/** One order in a list: number and amount, customer and city, date, status and payment. Memoised: it renders again only when its order changes. */
export const OrderRow = memo(function OrderRow({ order, onOpen, waiting = false }: { order: MobileOrderListItem; onOpen: (id: string) => void; waiting?: boolean }) {
  const styles = useStyles();
  const unconfirmed = order.confirmationStatus === 'unconfirmed' && order.status !== 'cancelled';
  return (
    <ListRow
      accessibilityLabel={`Order ${order.orderId}, ${statusLabel(order.status)}, ${formatRupees(order.total)}`}
      onPress={() => onOpen(order.id)}
      title={order.orderId}
      trailing={
        <AppText weight="semibold" style={styles.amount}>
          {formatRupees(order.total)}
        </AppText>
      }
      subtitle={[order.customerName, order.city].filter(Boolean).join(', ') || 'No name'}
      meta={formatDateTime(order.createdAt)}
      footer={
        <>
          <View style={styles.badges}>
            <OrderStatusBadge status={order.status} />
            <PaymentBadge method={order.paymentMethod} status={order.paymentStatus} />
          </View>
          {unconfirmed ? <Hint icon={PhoneCall} text="Waiting for your confirmation call" /> : null}
          {waiting ? <Hint icon={RefreshCw} text="A change is waiting to be sent" /> : null}
        </>
      }
    />
  );
});

function Hint({ icon, text }: { icon: typeof PhoneCall; text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.hint}>
      <Icon icon={icon} size="xs" tone="warning" />
      <AppText variant="caption" style={styles.hintText}>
        {text}
      </AppText>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  amount: { fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs, marginTop: t.space.xxs },
  hint: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs },
  hintText: { flexShrink: 1 },
}));
