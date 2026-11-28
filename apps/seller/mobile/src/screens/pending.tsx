import { AppText, Button, Card, CheckCircle, Clock, EmptyState, formatDateTime, Notice, RefreshCw, ScrollScreen, StatusBadge, Trash, useIsOnline } from '@markaz/mobile-kit';
import type { QueuedChange, StopReason } from '@markaz/mobile-kit/core';
import { useState } from 'react';
import { statusLabel } from '../labels';
import { usePending } from '../offline';
import { useServices, useStoreChoice } from '../services';

/** The seller's own change, in words. */
export function describeMine(item: QueuedChange): string {
  const { change } = item;
  if (change.kind === 'order.status') {
    const courier = change.courier ? `, ${change.courier} ${change.trackingNumber ?? ''}`.trimEnd() : '';
    return `Set the status to ${statusLabel(change.status)}${courier}`;
  }
  if (change.kind === 'order.note') return `Add the note "${change.text}"`;
  return `Set the stock to ${change.quantity}`;
}

/** What the server has now, after a conflict. */
export function describeServer(item: QueuedChange): string {
  const current = (item.current ?? {}) as { status?: string; variants?: { id: string; stockQuantity: number }[] };
  if (item.change.kind === 'stock.count') {
    const { variantId } = item.change;
    const variant = current.variants?.find((entry) => entry.id === variantId);
    return variant ? `The server now has ${variant.stockQuantity} in stock` : 'The server no longer has this variant';
  }
  const status = current.status ? statusLabel(current.status) : 'unknown';
  return item.change.kind === 'order.note' ? `The order changed on the server (status ${status})` : `The server now has the status ${status}`;
}

const STOPPED: Partial<Record<StopReason, string>> = {
  offline: 'The server cannot be reached. The changes stay here.',
  busy: 'The server is still working on the first change. Try again in a moment.',
  server: 'The server had a problem. The changes stay here.',
  upgrade: 'Update the app to send these changes.',
  signed_out: 'Sign in again to send these changes.',
};

export function PendingScreen() {
  const { runtime } = useServices();
  const { stores } = useStoreChoice();
  const changes = usePending();
  const online = useIsOnline();
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const sendNow = async () => {
    setSending(true);
    setNotice(null);
    try {
      const result = await runtime.queue()?.flush();
      setNotice(result?.stopped ? (STOPPED[result.stopped] ?? null) : null);
    } finally {
      setSending(false);
    }
  };

  if (changes.length === 0) {
    return (
      <ScrollScreen>
        <EmptyState icon={CheckCircle} title="Nothing is waiting" text="Changes made without a network appear here until they are sent." />
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen>
      <AppText variant="caption" tone="muted">
        Sent in this order. A change that cannot be sent holds back the ones after it.
      </AppText>
      {!online ? <Notice tone="info" text="Offline. These are sent when the network returns." /> : null}
      {notice ? <Notice text={notice} /> : null}
      <Button title="Send now" icon={RefreshCw} onPress={() => void sendNow()} busy={sending} disabled={!online || changes[0]!.state !== 'pending'} />
      {changes.map((item) => (
        <Card key={item.id} title={item.label} icon={Clock}>
          <AppText variant="caption" tone="muted">
            {stores.find((store) => store.id === item.storeId)?.name ?? 'Another store'} · made {formatDateTime(item.createdAt)}
          </AppText>
          <AppText>Yours: {describeMine(item)}</AppText>
          {item.state === 'conflict' ? (
            <>
              <Notice tone="danger" text={`${describeServer(item)}. Which one wins?`} />
              <Button
                title="Send mine anyway"
                onPress={() => {
                  void runtime
                    .queue()
                    ?.keepMine(item.id)
                    .then(() => sendNow());
                }}
                disabled={!online}
              />
              <Button title="Keep the server's value" kind="outline" onPress={() => void runtime.queue()?.discard(item.id)} />
            </>
          ) : item.state === 'failed' ? (
            <>
              <Notice tone="danger" text={item.problem?.message ?? 'The server refused this change.'} />
              <Button
                title="Try again"
                onPress={() => {
                  void runtime
                    .queue()
                    ?.keepMine(item.id)
                    .then(() => sendNow());
                }}
                disabled={!online}
              />
              <Button title="Discard" kind="ghost" icon={Trash} onPress={() => void runtime.queue()?.discard(item.id)} />
            </>
          ) : (
            <>
              <StatusBadge label="Waiting to be sent" tone="info" icon={RefreshCw} />
              <Button title="Discard" kind="ghost" icon={Trash} onPress={() => void runtime.queue()?.discard(item.id)} disabled={sending} />
            </>
          )}
        </Card>
      ))}
    </ScrollScreen>
  );
}
