import {
  AlertTriangle,
  AppText,
  Card,
  CheckCircle,
  EmptyState,
  ErrorState,
  formatDateTime,
  Inbox,
  LoadingState,
  OfflineBanner,
  Row,
  ScrollScreen,
} from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { fetchSync } from '../api';
import { adminKey, useServices, useUserId } from '../services';

/** Read only: what the outbox could not deliver. Retrying stays on the console. */
export function SyncScreen() {
  const { runtime } = useServices();
  const userId = useUserId();
  const sync = useQuery({ queryKey: adminKey(userId, 'sync'), queryFn: () => fetchSync(runtime.client), enabled: userId !== '' });

  const data = sync.data;
  if (!data) return sync.error ? <ErrorState message={errorText(sync.error)} onRetry={() => void sync.refetch()} /> : <LoadingState />;

  return (
    <ScrollScreen refreshing={sync.isRefetching} onRefresh={() => void sync.refetch()}>
      <OfflineBanner updatedAt={sync.dataUpdatedAt} />
      <Card title="Outbox" icon={Inbox}>
        <Row label="Waiting" value={String(data.counts.pending)} />
        <Row label="Failed" value={String(data.counts.dead)} strong />
        <Row label="Sent" value={String(data.counts.sent)} />
        <Row label="Oldest waiting" value={formatDateTime(data.oldestPendingAt)} />
        <Row label="Last sent" value={formatDateTime(data.lastSentAt)} />
      </Card>
      <Card title="Failed events" icon={AlertTriangle}>
        {data.events.docs.length === 0 ? <EmptyState icon={CheckCircle} title="Nothing has failed" /> : null}
        {data.events.docs.map((event) => (
          <View key={event.id}>
            <AppText>
              {event.entity} to {event.target}, {event.attempts} tries
            </AppText>
            <AppText variant="caption" tone="muted">{event.lastError ?? 'No error text'}</AppText>
            <AppText variant="caption" tone="muted">{formatDateTime(event.createdAt)}</AppText>
          </View>
        ))}
        <AppText variant="caption" tone="muted">Retry them from the console.</AppText>
      </Card>
    </ScrollScreen>
  );
}
