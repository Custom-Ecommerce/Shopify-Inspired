import type { MobileAlert } from '@markaz/contracts/mobile-data';
import { Button, colors, fontSize, formatDateTime, MIN_TAP_TARGET, Notice, radius, spacing, useIsOnline, PagedList, usePagedList } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { fetchAlerts, markAlertRead, markAllAlertsRead } from '../api';
import { useServices, useStoreChoice, useStoreKey } from '../services';

/** Where a tapped alert leads: the portal's link, mapped to a screen of the app. null: nothing here shows it. */
export function routeForAlert(link: string | null): string | null {
  if (!link) return null;
  const order = /^\/orders\/([0-9a-fA-F]{24})$/.exec(link);
  if (order) return `/orders/${order[1]}`;
  if (link === '/inventory') return '/products?stock=low';
  return null;
}

const AlertRow = memo(function AlertRow({ alert, onPress }: { alert: MobileAlert; onPress: (alert: MobileAlert) => void }) {
  const unread = alert.readAt === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread: ' : ''}${alert.title}`}
      onPress={() => onPress(alert)}
      style={({ pressed }) => [styles.row, unread && styles.unread, pressed && styles.pressed]}
    >
      <Text style={[styles.title, unread && styles.bold]}>{alert.title}</Text>
      <Text style={styles.body}>{alert.body}</Text>
      <Text style={styles.muted}>
        {formatDateTime(alert.createdAt)}
        {routeForAlert(alert.link) === null && alert.link ? ' · open on the website' : ''}
      </Text>
    </Pressable>
  );
});

export function AlertsScreen({ open }: { open: (path: string) => void }) {
  const { runtime } = useServices();
  const { store } = useStoreChoice();
  const storeId = store?.id ?? '';
  const key = useStoreKey(storeId);
  const queryClient = useQueryClient();
  const paged = usePagedList(key('alerts', 'list'), (page) => fetchAlerts(runtime.client, storeId, page), storeId !== '');
  const [problem, setProblem] = useState<string | null>(null);
  const unread = paged.list.data?.pages[0]?.unread ?? 0;
  const online = useIsOnline();

  const changed = useCallback(() => void queryClient.invalidateQueries({ queryKey: key('alerts') }), [queryClient, key]);

  const press = useCallback(
    (alert: MobileAlert) => {
      setProblem(null);
      if (alert.readAt === null && online) {
        void markAlertRead(runtime.client, storeId, alert.id)
          .then(changed)
          .catch((error: unknown) => setProblem(errorText(error)));
      }
      const path = routeForAlert(alert.link);
      if (path) open(path);
    },
    [runtime, storeId, changed, open, online],
  );
  const renderItem = useCallback(({ item }: { item: MobileAlert }) => <AlertRow alert={item} onPress={press} />, [press]);

  const readAll = () => {
    setProblem(null);
    void markAllAlertsRead(runtime.client, storeId)
      .then(changed)
      .catch((error: unknown) => setProblem(errorText(error)));
  };

  return (
    <PagedList
      paged={paged}
      renderItem={renderItem}
      empty={{ title: 'No alerts', text: 'New orders and low stock show up here.' }}
      header={
        <>
          {problem ? <Notice tone="danger" text={problem} /> : null}
          {unread > 0 ? (
            <Button title={`Mark all ${unread} as read`} kind="secondary" onPress={readAll} disabled={!online} />
          ) : (
            <Text style={styles.muted}>Nothing unread.</Text>
          )}
          {!online ? <Text style={styles.muted}>Marking alerts read needs a connection.</Text> : null}
        </>
      }
    />
  );
}

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
  unread: { borderColor: colors.primary, borderWidth: 2 },
  pressed: { opacity: 0.6 },
  title: { fontSize: fontSize.body, color: colors.text },
  bold: { fontWeight: '700' },
  body: { fontSize: fontSize.body, color: colors.text },
  muted: { fontSize: fontSize.caption, color: colors.textMuted },
});
