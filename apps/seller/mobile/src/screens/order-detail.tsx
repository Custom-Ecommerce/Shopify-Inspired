import { sellerCan } from '@markaz/auth/seller-capabilities';
import { mobileOrderDetailSchema, type MobileOrderDetail } from '@markaz/contracts/mobile-data';
import { COURIERS, ORDER_NOTE_TEXT_MAX } from '@markaz/contracts/order';
import {
  AppText,
  Button,
  CalendarDays,
  Card,
  Chip,
  Clock,
  ConfirmSheet,
  Contact,
  ErrorState,
  formatDateTime,
  formatRupees,
  History,
  Icon,
  LoadingState,
  makeStyles,
  MapPin,
  NoConnection,
  Notice,
  OfflineBanner,
  Package,
  Phone,
  Row,
  ScrollScreen,
  Sheet,
  StickyNote,
  TextField,
  Truck,
  useIsOnline,
  Wrap,
} from '@markaz/mobile-kit';
import { ApiError, errorText, recordKey } from '@markaz/mobile-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { addOrderNote, changeOrderStatus, fetchOrder, type StatusChange } from '../api';
import { OrderStatusBadge, PaymentBadge } from '../components/badges';
import { actionLabel, paymentLabel, statusLabel } from '../labels';
import { usePending, useSubmit, type SubmitInput } from '../offline';
import { useServices, useStoreChoice, useStoreKey } from '../services';
import { describeMine } from './pending';

const CHANGED_ELSEWHERE = 'This order changed on the server. The latest version is shown now; check it and try again.';

function taxLine(order: MobileOrderDetail): { label: string; value: string } | null {
  if (!order.taxAmount) return null;
  const rate = order.taxRatePercent !== undefined ? ` ${order.taxRatePercent}%` : '';
  const label = `${order.taxLabel || 'Tax'}${rate}${order.taxMode === 'inclusive' ? ' (included in prices)' : ''}`;
  return { label, value: formatRupees(order.taxAmount) };
}

/** Moves that undo the sale: kept apart from the forward step, never the big button. */
const BACKWARD = new Set(['cancelled', 'returned']);

export function OrderDetailScreen({ orderId, onOpenPending }: { orderId: string; onOpenPending?: () => void }) {
  const styles = useStyles();
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: key('order', orderId), queryFn: () => fetchOrder(runtime.client, storeId, orderId), enabled: storeId !== '' });

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  // The status the seller is asked to confirm (the sheet), or null.
  const [asking, setAsking] = useState<string | null>(null);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const submit = useSubmit();
  const online = useIsOnline();
  const waiting = usePending((entry) => entry.storeId === storeId && recordKey(entry.change) === `order:${orderId}`);

  const order = detail.data;
  if (!order) {
    if (!online) return <NoConnection onRetry={() => void detail.refetch()} />;
    return detail.error ? <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} /> : <LoadingState rows={4} />;
  }

  const canWrite = sellerCan(store?.role, 'orders.write');
  const canNote = sellerCan(store?.role, 'orders.notes');
  const statusWaiting = waiting.some((entry) => entry.change.kind === 'order.status');

  const show = (next: MobileOrderDetail) => {
    queryClient.setQueryData(key('order', orderId), next);
    void queryClient.invalidateQueries({ queryKey: key('orders') });
    void queryClient.invalidateQueries({ queryKey: key('dashboard') });
  };

  /** One change: shows the server's order, or that it waits, or why not. True when it was taken. */
  async function write(input: SubmitInput<{ order: MobileOrderDetail }>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      const outcome = await submit(input);
      if (outcome.kind === 'sent') show(outcome.answer.order);
      else setSaved(true);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        const current = mobileOrderDetailSchema.safeParse((error.body as { current?: unknown } | null)?.current);
        if (current.success) show(current.data);
        else void detail.refetch();
        setProblem(CHANGED_ELSEWHERE);
      } else {
        setProblem(errorText(error));
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  const move = (change: StatusChange) =>
    write({
      change: {
        storeId,
        change: { kind: 'order.status', orderId, ...change },
        revision: order.revision,
        label: `${order.orderId}: ${actionLabel(change.status)}`,
        seen: { status: order.status },
      },
      send: (idempotencyKey) => changeOrderStatus(runtime.client, storeId, orderId, order.revision, change, idempotencyKey),
    });

  const dispatch = async () => {
    if (courier.trim().length < 2 || !tracking.trim()) {
      setProblem('Enter the courier and the tracking number.');
      return;
    }
    if (await move({ status: 'dispatched', courier: courier.trim(), trackingNumber: tracking.trim() })) setDispatching(false);
  };

  const saveNote = async () => {
    const text = note.trim();
    if (!text) return;
    const done = await write({
      change: { storeId, change: { kind: 'order.note', orderId, text }, revision: order.revision, label: `${order.orderId}: note` },
      send: (idempotencyKey) => addOrderNote(runtime.client, storeId, orderId, order.revision, text, idempotencyKey),
    });
    if (done) setNote('');
  };

  const tax = taxLine(order);
  const forward = order.allowedNext.filter((next) => !BACKWARD.has(next));
  const backward = order.allowedNext.filter((next) => BACKWARD.has(next));
  const canMove = canWrite && !statusWaiting && order.allowedNext.length > 0;
  const ask = (next: string) => {
    setProblem(null);
    if (next === 'dispatched') setDispatching(true);
    else setAsking(next);
  };

  // The next step in the thumb zone: the forward move as the one primary button, anything that undoes the sale apart from it.
  const footer = canMove ? (
    <>
      {forward.map((next, index) => (
        <Button key={next} title={actionLabel(next)} kind={index === 0 ? 'primary' : 'outline'} icon={next === 'dispatched' ? Truck : undefined} onPress={() => ask(next)} busy={busy && index === 0} disabled={busy} />
      ))}
      {backward.map((next) => (
        <Button key={next} title={actionLabel(next)} kind="ghost" onPress={() => ask(next)} disabled={busy} />
      ))}
    </>
  ) : undefined;
  const sheetOpen = asking !== null || dispatching;

  return (
    <>
      <ScrollScreen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()} footer={footer}>
        <OfflineBanner updatedAt={detail.dataUpdatedAt} />
        {online && detail.error ? <Notice text={`Showing the order saved at ${formatDateTime(detail.dataUpdatedAt)}. ${errorText(detail.error)}`} /> : null}

        <Card>
          <View style={styles.title}>
            <AppText accessibilityRole="header" variant="title" style={styles.flex}>
              {order.orderId}
            </AppText>
            <OrderStatusBadge status={order.status} />
          </View>
          <Row icon={CalendarDays} label="Placed" value={formatDateTime(order.createdAt)} />
          <View style={styles.payment}>
            <AppText tone="muted" style={styles.flex}>
              {paymentLabel(order.paymentMethod, order.paymentStatus)}
            </AppText>
            <PaymentBadge method={order.paymentMethod} status={order.paymentStatus} />
          </View>
          {order.confirmationStatus === 'unconfirmed' ? <Notice tone="warning" text="This order still waits for your confirmation call (record it on the website)." /> : null}
        </Card>

        {problem && !sheetOpen ? <Notice tone="danger" text={problem} /> : null}
        {saved ? <Notice tone="success" text="Saved on this phone. It is sent when the connection is back." /> : null}
        {waiting.length > 0 ? (
          <Card title="Waiting to be sent" icon={Clock}>
            {waiting.map((entry) => (
              <AppText key={entry.id}>
                {describeMine(entry)}
                {entry.state === 'pending' ? '' : ' (needs your decision, see Pending changes)'}
              </AppText>
            ))}
            {onOpenPending ? <Button title="Pending changes" kind="outline" onPress={onOpenPending} /> : null}
          </Card>
        ) : null}
        {!canWrite ? (
          <Notice tone="info" text={`Your role can view this order${canNote ? ' and add notes' : ''}, not change its status.`} />
        ) : statusWaiting ? (
          <Notice tone="info" text="A status change is waiting to be sent. The next one can be made after it." />
        ) : order.allowedNext.length === 0 ? (
          <AppText variant="caption" tone="muted">
            No further status change.
          </AppText>
        ) : null}

        <Card title="Customer" icon={Contact}>
          <AppText weight="medium">{order.customerName ?? 'No name'}</AppText>
          {order.phone ? (
            <View style={styles.line}>
              <Icon icon={Phone} size="sm" tone="muted" />
              <AppText>{order.phone}</AppText>
            </View>
          ) : null}
          {order.address || order.city ? (
            <View style={styles.line}>
              <Icon icon={MapPin} size="sm" tone="muted" />
              <AppText style={styles.flex}>{[order.address, order.city].filter(Boolean).join(', ')}</AppText>
            </View>
          ) : null}
          {order.customerNote ? (
            <AppText variant="caption" tone="muted">
              Customer wrote: {order.customerNote}
            </AppText>
          ) : null}
        </Card>

        <Card title="Items" icon={Package}>
          {order.items.map((item, index) => (
            <View key={`${item.sku ?? item.productTitle}-${index}`}>
              <Row label={`${item.quantity} x ${item.productTitle}`} value={formatRupees(item.lineTotal)} />
              {item.variantTitle && item.variantTitle !== 'Default' ? (
                <AppText variant="caption" tone="muted">
                  {item.variantTitle}
                </AppText>
              ) : null}
            </View>
          ))}
          <View style={styles.rule} />
          <Row label="Subtotal" value={formatRupees(order.subtotal)} />
          {order.discountAmount > 0 ? <Row label={order.discountCode ? `Discount (${order.discountCode})` : 'Discount'} value={`- ${formatRupees(order.discountAmount)}`} /> : null}
          <Row label="Delivery" value={formatRupees(order.deliveryCharges)} />
          {tax ? <Row label={tax.label} value={tax.value} /> : null}
          <Row label="Total" value={formatRupees(order.total)} strong />
        </Card>

        {order.courier || order.trackingNumber ? (
          <Card title="Courier" icon={Truck}>
            {order.courier ? <Row label="Courier" value={order.courier} /> : null}
            {order.trackingNumber ? <Row label="Tracking number" value={order.trackingNumber} /> : null}
          </Card>
        ) : null}

        {canWrite && order.canCancel ? (
          <AppText variant="caption" tone="muted">
            To cancel this order, use the website.
          </AppText>
        ) : null}

        <Card title="Notes" icon={StickyNote}>
          {order.notes.length === 0 ? (
            <AppText variant="caption" tone="muted">
              No notes yet.
            </AppText>
          ) : null}
          {order.notes.map((entry, index) => (
            <View key={entry.id ?? index}>
              <AppText>{entry.text}</AppText>
              <AppText variant="caption" tone="muted">
                {formatDateTime(entry.at)}
              </AppText>
            </View>
          ))}
          {canNote ? (
            <>
              <TextField label="New note (only your team sees it)" value={note} onChangeText={setNote} multiline maxLength={ORDER_NOTE_TEXT_MAX} />
              <Button title="Add note" kind="outline" icon={StickyNote} onPress={() => void saveNote()} disabled={!note.trim()} busy={busy} />
            </>
          ) : null}
        </Card>

        <Card title="Timeline" icon={History}>
          {order.timeline.map((entry) => (
            <View key={entry.id} style={styles.event}>
              <View style={styles.eventDot} />
              <View style={styles.flex}>
                <AppText weight="medium">{entry.title}</AppText>
                {entry.detail ? (
                  <AppText variant="caption" tone="muted">
                    {entry.detail}
                  </AppText>
                ) : null}
                <AppText variant="caption" tone="muted">
                  {formatDateTime(entry.at)}
                </AppText>
              </View>
            </View>
          ))}
        </Card>
      </ScrollScreen>

      <ConfirmSheet
        visible={asking !== null}
        title={asking ? `${actionLabel(asking)}?` : ''}
        message={
          asking
            ? `${order.orderId} goes from ${statusLabel(order.status)} to ${statusLabel(asking)}.${online ? '' : ' There is no connection: it is saved on this phone and sent when the network returns.'}`
            : undefined
        }
        confirmLabel={asking ? `Yes, ${actionLabel(asking).toLowerCase()}` : ''}
        destructive={asking !== null && BACKWARD.has(asking)}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const next = asking;
          setAsking(null);
          if (next) void move({ status: next });
        }}
      />

      <Sheet visible={dispatching} title="Dispatch order" onClose={() => setDispatching(false)} busy={busy}>
        <AppText tone="muted">Choose the courier and enter the tracking number.</AppText>
        <Wrap>
          {COURIERS.filter((name) => name !== 'Other').map((name) => (
            <Chip key={name} label={name} selected={courier === name} onPress={() => setCourier(name)} />
          ))}
        </Wrap>
        <TextField label="Courier" value={courier} onChangeText={setCourier} />
        <TextField label="Tracking number" value={tracking} onChangeText={setTracking} autoCapitalize="characters" autoCorrect={false} />
        {problem ? <Notice tone="danger" text={problem} /> : null}
        <Button title="Confirm dispatch" icon={Truck} onPress={() => void dispatch()} busy={busy} />
        <Button title="Not now" kind="ghost" onPress={() => setDispatching(false)} disabled={busy} />
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  title: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  payment: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.sm },
  rule: { height: 1, backgroundColor: t.colors.border },
  event: { flexDirection: 'row', gap: t.space.md },
  eventDot: { width: 10, height: 10, marginTop: 6, borderRadius: 5, backgroundColor: t.colors.link },
}));
