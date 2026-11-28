import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { formatDateTime } from '../core/dates';
import { errorText } from '../core/errors';
import { useIsOnline } from '../native/network';
import { NoConnection, OfflineBanner } from './offline';
import { AppText, EmptyState, ErrorState, LoadingState, Notice, type IconComponent } from './primitives';
import { makeStyles, useTheme } from './theme-provider';

interface Page {
  docs: { id: string }[];
  page: number;
  totalPages: number;
}

/** A list read page by page. A row that two pages repeat (something new arrived between two loads) is shown once. */
export function usePagedList<P extends Page>(queryKey: unknown[], fetchPage: (page: number) => Promise<P>, enabled: boolean) {
  const list = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: P) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
  });
  const rows = useMemo(() => {
    const byId = new Map<string, P['docs'][number]>();
    for (const page of list.data?.pages ?? []) for (const row of page.docs) byId.set(row.id, row);
    return [...byId.values()];
  }, [list.data]);
  const more = () => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };
  return { list, rows, more };
}

/** What usePagedList gives. */
export interface PagedSource<T> {
  rows: T[];
  more: () => void;
  list: { data: unknown; error: unknown; dataUpdatedAt: number; isRefetching: boolean; isFetchingNextPage: boolean; refetch: () => unknown };
}

export interface PagedListProps<T> {
  paged: PagedSource<T>;
  renderItem: ListRenderItem<T>;
  /** Filters above the rows. An element, not a component: a search box keeps its focus while the list updates. */
  header: ReactElement;
  empty: { title: string; text?: string; icon?: IconComponent };
}

const keyOf = (row: { id: string }) => row.id;

/** The list screens' shared body: FlashList with stable keys, pull to refresh, paging, offline states, and never a blank screen. */
export function PagedList<T extends { id: string }>({ paged, renderItem, header, empty }: PagedListProps<T>) {
  const { list, rows, more } = paged;
  const online = useIsOnline();
  const theme = useTheme();
  const styles = useStyles();
  const nothing =
    list.data !== undefined ? (
      <EmptyState title={empty.title} text={empty.text} icon={empty.icon} />
    ) : !online ? (
      <NoConnection onRetry={() => void list.refetch()} />
    ) : list.error ? (
      <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
    ) : (
      <LoadingState rows={5} kind="row" />
    );
  return (
    <View style={styles.screen}>
      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyOf}
        ListHeaderComponent={
          <View style={styles.header}>
            <OfflineBanner updatedAt={list.data === undefined ? undefined : list.dataUpdatedAt} />
            {header}
            {online && list.error && list.data ? <Notice text={`Showing what was saved at ${formatDateTime(list.dataUpdatedAt)}. ${errorText(list.error)}`} /> : null}
          </View>
        }
        ListEmptyComponent={nothing}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <AppText variant="caption" tone="muted" style={styles.more}>
              Loading more…
            </AppText>
          ) : null
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={more}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        progressViewOffset={theme.space.sm}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.background },
  content: { padding: t.space.lg },
  header: { gap: t.space.md, paddingBottom: t.space.md },
  more: { textAlign: 'center', padding: t.space.md },
}));
