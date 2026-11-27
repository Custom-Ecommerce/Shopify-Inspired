import { Card, EmptyState, ErrorState, formatDateTime, LoadingState, OfflineBanner, Row, ScrollScreen, uiStyles } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
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
      <Card title="Outbox">
        <Row label="Waiting" value={String(data.counts.pending)} />
        <Row label="Failed" value={String(data.counts.dead)} strong />
        <Row label="Sent" value={String(data.counts.sent)} />
        <Row label="Oldest waiting" value={formatDateTime(data.oldestPendingAt)} />
        <Row label="Last sent" value={formatDateTime(data.lastSentAt)} />
      </Card>
      <Card title="Failed events">
        {data.events.docs.length === 0 ? <EmptyState title="Nothing has failed" /> : null}
        {data.events.docs.map((event) => (
          <View key={event.id}>
            <Text style={uiStyles.body}>
              {event.entity} to {event.target}, {event.attempts} tries
            </Text>
            <Text style={uiStyles.muted}>{event.lastError ?? 'No error text'}</Text>
            <Text style={uiStyles.muted}>{formatDateTime(event.createdAt)}</Text>
          </View>
        ))}
        <Text style={uiStyles.muted}>Retry them from the console.</Text>
      </Card>
    </ScrollScreen>
  );
}
