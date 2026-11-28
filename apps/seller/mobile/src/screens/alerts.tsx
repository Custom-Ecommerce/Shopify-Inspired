import type { MobileAlert } from '@markaz/contracts/mobile-data';
import { AppText, Bell, Button, CheckCircle, formatDateTime, Icon, ListRow, makeStyles, Notice, PagedList, useIsOnline, usePagedList } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';
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
  const styles = useStyles();
  const unread = alert.readAt === null;
  return (
    <ListRow
      accessibilityLabel={`${unread ? 'Unread: ' : ''}${alert.title}`}
      onPress={() => onPress(alert)}
      leading={
        <View style={[styles.dot, unread && styles.unread]}>
          <Icon icon={Bell} size="sm" tone={unread ? 'onPrimary' : 'muted'} />
        </View>
      }
      title={alert.title}
      subtitle={alert.body}
      meta={`${formatDateTime(alert.createdAt)}${routeForAlert(alert.link) === null && alert.link ? ' · open on the website' : ''}`}
    />
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
      empty={{ icon: Bell, title: 'No alerts', text: 'New orders and low stock show up here.' }}
      header={
        <>
          {problem ? <Notice tone="danger" text={problem} /> : null}
          {unread > 0 ? (
            <Button title={`Mark all ${unread} as read`} kind="outline" icon={CheckCircle} onPress={readAll} disabled={!online} />
          ) : (
            <AppText variant="caption" tone="muted">
              Nothing unread.
            </AppText>
          )}
          {!online ? <Notice tone="info" text="Marking alerts read needs a connection." /> : null}
        </>
      }
    />
  );
}

const useStyles = makeStyles((t) => ({
  dot: { width: 36, height: 36, borderRadius: t.radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.muted },
  unread: { backgroundColor: t.colors.primary },
}));
