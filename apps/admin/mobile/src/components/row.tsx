import { colors, fontSize, MIN_TAP_TARGET, radius, spacing } from '@markaz/mobile-kit';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface ListRowProps {
  id: string;
  title: string;
  /** Right of the title. */
  value?: string;
  lines: readonly string[];
  onOpen?: (id: string) => void;
}

/** One row of any admin list. Memoised: it renders again only when its text changes. */
export const ListRow = memo(function ListRow({ id, title, value, lines, onOpen }: ListRowProps) {
  const body = (
    <>
      <View style={styles.line}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {value ? <Text style={styles.title}>{value}</Text> : null}
      </View>
      {lines.map((line, index) => (
        <Text key={index} style={styles.muted} numberOfLines={2}>
          {line}
        </Text>
      ))}
    </>
  );
  if (!onOpen) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value ? `${title}, ${value}` : title} onPress={() => onOpen(id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
});

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
  pressed: { opacity: 0.6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  title: { fontSize: fontSize.body, fontWeight: '700', color: colors.text, flexShrink: 1 },
  muted: { fontSize: fontSize.caption, color: colors.textMuted },
});
