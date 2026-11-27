import { Card, Chip, EmptyState, ErrorState, LoadingState, ScrollScreen, uiStyles } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { Text } from 'react-native';
import { roleLabel } from '../labels';
import { useStoreChoice } from '../services';

/** The store switcher: every store the account can work in, with the role in each. */
export function StoresScreen({ onDone }: { onDone: () => void }) {
  const { stores, store, select, loading, error, reload } = useStoreChoice();
  if (loading && !error) return <LoadingState />;
  return (
    <ScrollScreen onRefresh={reload}>
      {error ? <ErrorState message={errorText(error)} onRetry={reload} /> : null}
      {!error && stores.length === 0 ? <EmptyState title="No store yet" /> : null}
      {stores.map((entry) => (
        <Card key={entry.id}>
          <Text style={uiStyles.title}>{entry.name}</Text>
          <Text style={uiStyles.muted}>Your role: {roleLabel(entry.role)}</Text>
          <Chip
            label={entry.id === store?.id ? `Selected: ${entry.name}` : `Open ${entry.name}`}
            selected={entry.id === store?.id}
            onPress={() => {
              select(entry.id);
              onDone();
            }}
          />
        </Card>
      ))}
    </ScrollScreen>
  );
}
