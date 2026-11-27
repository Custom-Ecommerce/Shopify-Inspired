import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, fontSize, MIN_TAP_TARGET, radius, spacing } from '../theme';

/** A scrolling screen with the app's padding; pull to refresh when `onRefresh` is given. */
export function ScrollScreen({ children, refreshing = false, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled = false,
  busy = false,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[kind], (off || pressed) && styles.dim, style]}
    >
      {busy ? <ActivityIndicator color={kind === 'secondary' ? colors.primary : colors.onPrimary} /> : null}
      <Text style={[styles.buttonText, kind === 'secondary' && styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

/** A filter choice. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function TextField({ label, error, style, ...input }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, input.multiline && styles.multiline, error ? styles.inputError : null, style]}
        {...input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** A label on the left, its value on the right. */
export function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

/** Grey blocks while the first load runs: never a blank screen. */
export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessible style={styles.content}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skeleton} />
      ))}
    </View>
  );
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <View style={styles.state}>
      <Text style={styles.cardTitle}>{title}</Text>
      {text ? <Text style={styles.muted}>{text}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.state}>
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
      {onRetry ? <Button title="Try again" kind="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** A short message over a screen: a warning or a refusal. */
export function Notice({ text, tone = 'warning' }: { text: string; tone?: 'warning' | 'danger' }) {
  return (
    <View style={styles.notice}>
      <Text accessibilityRole="alert" style={[styles.noticeText, tone === 'danger' && { color: colors.danger }]}>
        {text}
      </Text>
    </View>
  );
}

export const uiStyles = StyleSheet.create({
  muted: { fontSize: fontSize.caption, color: colors.textMuted },
  body: { fontSize: fontSize.body, color: colors.text },
  title: { fontSize: fontSize.title, fontWeight: '700', color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  button: {
    minHeight: MIN_TAP_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  dim: { opacity: 0.6 },
  buttonText: { fontSize: fontSize.body, fontWeight: '600', color: colors.onPrimary },
  secondaryText: { color: colors.primary },
  chip: {
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.caption, color: colors.text },
  chipTextSelected: { color: colors.onPrimary, fontWeight: '600' },
  field: { gap: spacing.xs },
  label: { fontSize: fontSize.caption, color: colors.textMuted },
  input: {
    minHeight: MIN_TAP_TARGET + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  error: { fontSize: fontSize.body, color: colors.danger },
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardTitle: { fontSize: fontSize.title, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { fontSize: fontSize.body, color: colors.textMuted, flexShrink: 1 },
  rowValue: { fontSize: fontSize.body, color: colors.text, flexShrink: 1, textAlign: 'right' },
  strong: { fontWeight: '700', color: colors.text },
  skeleton: { height: 72, borderRadius: radius.md, backgroundColor: colors.border, opacity: 0.5 },
  state: { padding: spacing.xl, gap: spacing.md, alignItems: 'center' },
  muted: { fontSize: fontSize.body, color: colors.textMuted, textAlign: 'center' },
  notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSurface },
  noticeText: { fontSize: fontSize.body, color: colors.warning },
});
