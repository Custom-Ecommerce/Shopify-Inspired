import { AppText, Card, Chip, EmptyState, ErrorState, LoadingState, ScrollScreen, Store } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { roleLabel } from '../labels';
import { useStoreChoice } from '../services';

/** The store switcher: every store the account can work in, with the role in each. */
export function StoresScreen({ onDone }: { onDone: () => void }) {
  const { stores, store, select, loading, error, reload } = useStoreChoice();
  if (loading && !error) return <LoadingState />;
  return (
    <ScrollScreen onRefresh={reload}>
      {error ? <ErrorState message={errorText(error)} onRetry={reload} /> : null}
      {!error && stores.length === 0 ? <EmptyState icon={Store} title="No store yet" /> : null}
      {stores.map((entry) => (
        <Card key={entry.id} title={entry.name} icon={Store}>
          <AppText variant="caption" tone="muted">
            Your role: {roleLabel(entry.role)}
          </AppText>
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
