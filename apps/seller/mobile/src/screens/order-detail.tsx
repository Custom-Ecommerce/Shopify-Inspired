import { sellerCan } from '@markaz/auth/seller-capabilities';
import { mobileOrderDetailSchema, type MobileOrderDetail } from '@markaz/contracts/mobile-data';
import { COURIERS, ORDER_NOTE_TEXT_MAX } from '@markaz/contracts/order';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  formatDateTime,
  formatRupees,
  LoadingState,
  NoConnection,
  Notice,
  OfflineBanner,
  Row,
  ScrollScreen,
  TextField,
  uiStyles,
  useIsOnline,
} from '@markaz/mobile-kit';
import { ApiError, errorText, recordKey } from '@markaz/mobile-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { addOrderNote, changeOrderStatus, fetchOrder, type StatusChange } from '../api';
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

export function OrderDetailScreen({ orderId, onOpenPending }: { orderId: string; onOpenPending?: () => void }) {
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
  return (
    <ScrollScreen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
      <OfflineBanner updatedAt={detail.dataUpdatedAt} />
      {online && detail.error ? <Notice text={`Showing the order saved at ${formatDateTime(detail.dataUpdatedAt)}. ${errorText(detail.error)}`} /> : null}

      <Card>
        <Text accessibilityRole="header" style={uiStyles.title}>
          {order.orderId}
        </Text>
        <Row label="Status" value={statusLabel(order.status)} strong />
        <Row label="Placed" value={formatDateTime(order.createdAt)} />
        <Row label="Payment" value={paymentLabel(order.paymentMethod, order.paymentStatus)} />
        {order.confirmationStatus === 'unconfirmed' ? <Notice text="This order still waits for your confirmation call (record it on the website)." /> : null}
      </Card>

      <Card title="Customer">
        <Text style={uiStyles.body}>{order.customerName ?? 'No name'}</Text>
        {order.phone ? <Text style={uiStyles.body}>{order.phone}</Text> : null}
        {order.address || order.city ? <Text style={uiStyles.body}>{[order.address, order.city].filter(Boolean).join(', ')}</Text> : null}
        {order.customerNote ? <Text style={uiStyles.muted}>Customer wrote: {order.customerNote}</Text> : null}
      </Card>

      <Card title="Items">
        {order.items.map((item, index) => (
          <View key={`${item.sku ?? item.productTitle}-${index}`}>
            <Row label={`${item.quantity} x ${item.productTitle}`} value={formatRupees(item.lineTotal)} />
            {item.variantTitle && item.variantTitle !== 'Default' ? <Text style={uiStyles.muted}>{item.variantTitle}</Text> : null}
          </View>
        ))}
        <Row label="Subtotal" value={formatRupees(order.subtotal)} />
        {order.discountAmount > 0 ? <Row label={order.discountCode ? `Discount (${order.discountCode})` : 'Discount'} value={`- ${formatRupees(order.discountAmount)}`} /> : null}
        <Row label="Delivery" value={formatRupees(order.deliveryCharges)} />
        {tax ? <Row label={tax.label} value={tax.value} /> : null}
        <Row label="Total" value={formatRupees(order.total)} strong />
      </Card>

      {order.courier || order.trackingNumber ? (
        <Card title="Courier">
          {order.courier ? <Row label="Courier" value={order.courier} /> : null}
          {order.trackingNumber ? <Row label="Tracking number" value={order.trackingNumber} /> : null}
        </Card>
      ) : null}

      {problem ? <Notice tone="danger" text={problem} /> : null}
      {saved ? <Notice text="Saved on this phone. It is sent when the connection is back." /> : null}
      {waiting.length > 0 ? (
        <Card title="Waiting to be sent">
          {waiting.map((entry) => (
            <Text key={entry.id} style={uiStyles.body}>
              {describeMine(entry)}
              {entry.state === 'pending' ? '' : ' (needs your decision, see Pending changes)'}
            </Text>
          ))}
          {onOpenPending ? <Button title="Pending changes" kind="secondary" onPress={onOpenPending} /> : null}
        </Card>
      ) : null}

      <Card title="Actions">
        {!canWrite ? (
          <Text style={uiStyles.muted}>Your role can view this order{canNote ? ' and add notes' : ''}, not change its status.</Text>
        ) : statusWaiting ? (
          <Text style={uiStyles.muted}>A status change is waiting to be sent. The next one can be made after it.</Text>
        ) : order.allowedNext.length === 0 ? (
          <Text style={uiStyles.muted}>No further status change.</Text>
        ) : (
          order.allowedNext.map((next) =>
            next === 'dispatched' ? (
              <View key={next}>
                {!dispatching ? (
                  <Button title={actionLabel(next)} onPress={() => setDispatching(true)} disabled={busy} />
                ) : (
                  <View>
                    <View style={uiStyles.wrap}>
                      {COURIERS.filter((name) => name !== 'Other').map((name) => (
                        <Chip key={name} label={name} selected={courier === name} onPress={() => setCourier(name)} />
                      ))}
                    </View>
                    <TextField label="Courier" value={courier} onChangeText={setCourier} />
                    <TextField label="Tracking number" value={tracking} onChangeText={setTracking} autoCapitalize="characters" autoCorrect={false} />
                    <Button title="Confirm dispatch" onPress={() => void dispatch()} busy={busy} />
                  </View>
                )}
              </View>
            ) : (
              <Button key={next} title={actionLabel(next)} onPress={() => void move({ status: next })} busy={busy} />
            ),
          )
        )}
        {canWrite && order.canCancel ? <Text style={uiStyles.muted}>To cancel this order, use the website.</Text> : null}
      </Card>

      <Card title="Notes">
        {order.notes.length === 0 ? <Text style={uiStyles.muted}>No notes yet.</Text> : null}
        {order.notes.map((entry, index) => (
          <View key={entry.id ?? index}>
            <Text style={uiStyles.body}>{entry.text}</Text>
            <Text style={uiStyles.muted}>{formatDateTime(entry.at)}</Text>
          </View>
        ))}
        {canNote ? (
          <>
            <TextField label="New note (only your team sees it)" value={note} onChangeText={setNote} multiline maxLength={ORDER_NOTE_TEXT_MAX} />
            <Button title="Add note" kind="secondary" onPress={() => void saveNote()} disabled={!note.trim()} busy={busy} />
          </>
        ) : null}
      </Card>

      <Card title="Timeline">
        {order.timeline.map((entry) => (
          <View key={entry.id}>
            <Text style={uiStyles.body}>{entry.title}</Text>
            {entry.detail ? <Text style={uiStyles.muted}>{entry.detail}</Text> : null}
            <Text style={uiStyles.muted}>{formatDateTime(entry.at)}</Text>
          </View>
        ))}
      </Card>
    </ScrollScreen>
  );
}
