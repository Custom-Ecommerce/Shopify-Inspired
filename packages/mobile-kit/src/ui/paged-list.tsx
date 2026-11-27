import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDateTime } from '../core/dates';
import { errorText } from '../core/errors';
import { useIsOnline } from '../native/network';
import { colors, spacing } from '../theme';
import { NoConnection, OfflineBanner } from './offline';
import { EmptyState, ErrorState, LoadingState, Notice, uiStyles } from './primitives';

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
  empty: { title: string; text?: string };
}

const keyOf = (row: { id: string }) => row.id;

/** The list screens' shared body: FlashList with stable keys, pull to refresh, paging, offline states, and never a blank screen. */
export function PagedList<T extends { id: string }>({ paged, renderItem, header, empty }: PagedListProps<T>) {
  const { list, rows, more } = paged;
  const online = useIsOnline();
  const nothing =
    list.data !== undefined ? (
      <EmptyState title={empty.title} text={empty.text} />
    ) : !online ? (
      <NoConnection onRetry={() => void list.refetch()} />
    ) : list.error ? (
      <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
    ) : (
      <LoadingState />
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
        ListFooterComponent={list.isFetchingNextPage ? <Text style={uiStyles.muted}>Loading more…</Text> : null}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={more}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  header: { gap: spacing.sm, paddingBottom: spacing.md },
});
