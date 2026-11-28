import { AppText, ListRow as KitRow, StatusBadge, type Tone } from '@markaz/mobile-kit';
import { memo } from 'react';

export interface ListRowProps {
  id: string;
  title: string;
  /** Right of the title. */
  value?: string;
  lines: readonly string[];
  /** A status pill under the lines. */
  badge?: { label: string; tone: Tone };
  onOpen?: (id: string) => void;
}

/** One row of any admin list: the shared list card. Memoised: it renders again only when its text changes. */
export const ListRow = memo(function ListRow({ id, title, value, lines, badge, onOpen }: ListRowProps) {
  return (
    <KitRow
      accessibilityLabel={value ? `${title}, ${value}` : title}
      onPress={onOpen ? () => onOpen(id) : undefined}
      title={title}
      trailing={value ? <AppText weight="semibold">{value}</AppText> : undefined}
      footer={
        <>
          {lines.map((line, index) => (
            <AppText key={index} variant="caption" tone="muted" numberOfLines={2}>
              {line}
            </AppText>
          ))}
          {badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
        </>
      }
    />
  );
});
