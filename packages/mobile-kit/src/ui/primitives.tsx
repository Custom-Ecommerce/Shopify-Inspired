import { useContext, useState, type ComponentType, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { IconSize, Theme, Tone, TypeVariant } from '../theme';
import { tapFeedback } from './haptics';
import { AlertCircle, AlertTriangle, ArrowLeft, Check, CheckCircle, ChevronDown, ChevronRight, Eye, EyeOff, Info, Inbox, Search, WifiOff, X } from './icons';
import { makeStyles, useTheme } from './theme-provider';

/*
 * The shared building blocks of both apps (S9-UI). Every colour, size and font comes from the theme; every control has a pressed, a disabled and (where it
 * waits) a busy state, a role and a label, and is at least 48 dp tall.
 */

// ---------------------------------------------------------------------------------------------------------------- icon and text

/** A lucide icon component (ui/icons.ts). */
export type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export type IconTone = 'default' | 'muted' | 'link' | 'primary' | 'onPrimary' | Tone;

function iconColor(theme: Theme, tone: IconTone): string {
  switch (tone) {
    case 'default':
      return theme.colors.foreground;
    case 'muted':
      return theme.colors.mutedForeground;
    case 'link':
      return theme.colors.link;
    case 'primary':
      return theme.colors.link;
    case 'onPrimary':
      return theme.colors.primaryForeground;
    default:
      return theme.tones[tone].solid;
  }
}

/** One icon, sized and coloured from the theme. Decoration for screen readers: the control around it carries the label. */
export function Icon({ icon: Glyph, size = 'md', tone = 'default', color }: { icon: IconComponent; size?: IconSize; tone?: IconTone; color?: string }) {
  const theme = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Glyph size={theme.iconSize[size]} color={color ?? iconColor(theme, tone)} strokeWidth={size === 'xl' || size === 'xxl' ? 1.75 : 2} />
    </View>
  );
}

export type TextTone = 'default' | 'muted' | 'link' | 'danger' | 'onPrimary';

/** Text in the type scale. */
export function AppText({
  variant = 'body',
  tone = 'default',
  weight,
  style,
  ...props
}: TextProps & { variant?: TypeVariant; tone?: TextTone; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }) {
  const theme = useTheme();
  const color =
    tone === 'muted'
      ? theme.colors.mutedForeground
      : tone === 'link'
        ? theme.colors.link
        : tone === 'danger'
          ? theme.tones.destructive.solid
          : tone === 'onPrimary'
            ? theme.colors.primaryForeground
            : theme.colors.foreground;
  return <Text {...props} style={[theme.type[variant], { color }, weight ? theme.weight[weight] : null, style]} />;
}

// ---------------------------------------------------------------------------------------------------------------- screens

export interface ScreenProps {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** A bar fixed to the bottom, above the system bar: the screen's main action in the thumb zone. */
  footer?: ReactNode;
}

/** A screen: scrolls, moves out of the keyboard's way, pulls to refresh when `onRefresh` is given, and keeps an optional action bar at the bottom. */
export function Screen({ children, refreshing = false, onRefresh, footer }: ScreenProps) {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.link]} tintColor={theme.colors.link} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: theme.space.md + (insets?.bottom ?? 0) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

/** The name the screens have used since Sprint 9 B4. */
export const ScrollScreen = Screen;

/** Children side by side, wrapping onto the next line. */
export function Wrap({ children, gap = 'sm' }: { children: ReactNode; gap?: 'xs' | 'sm' | 'md' }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[gap] }}>{children}</View>;
}

/** Children one under the other with the card rhythm between them. */
export function Stack({ children, gap = 'sm' }: { children: ReactNode; gap?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const theme = useTheme();
  return <View style={{ gap: theme.space[gap] }}>{children}</View>;
}

// ---------------------------------------------------------------------------------------------------------------- buttons

export type ButtonKind = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'danger';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  size?: 'md' | 'sm';
  icon?: IconComponent;
  disabled?: boolean;
  busy?: boolean;
  /** Fills the row (default); false sizes the button to its text. */
  block?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, onPress, kind = 'primary', size = 'md', icon, disabled = false, busy = false, block = true, accessibilityHint, style }: ButtonProps) {
  const theme = useTheme();
  const styles = useStyles();
  const off = disabled || busy;
  const look = kind === 'danger' ? 'destructive' : kind;
  const fg =
    look === 'primary'
      ? theme.colors.primaryForeground
      : look === 'secondary'
        ? theme.colors.secondaryForeground
        : look === 'destructive'
          ? theme.colors.destructiveForeground
          : look === 'ghost'
            ? theme.colors.link
            : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      android_ripple={{ color: theme.colors.border }}
      style={({ pressed }) => [styles.button, size === 'sm' && styles.buttonSm, styles[look], !block && styles.inline, pressed && styles.pressed, off && styles.off, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon icon={icon} size="sm" color={fg} /> : null}
      <Text style={[theme.type.label, theme.weight.semibold, { color: fg }]} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}

/** A round icon-only button (header actions). `badge` shows a count on it. */
export function IconButton({ icon, label, onPress, badge, tone = 'default' }: { icon: IconComponent; label: string; onPress: () => void; badge?: number; tone?: IconTone }) {
  const styles = useStyles();
  const theme = useTheme();
  const count = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} unread` : label}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.colors.muted }]}
    >
      <Icon icon={icon} size="md" tone={tone} />
      {count ? (
        <View style={styles.badge}>
          <Text style={[theme.type.caption, theme.weight.semibold, styles.badgeText]}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** A filter choice. */
export function Chip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: IconComponent }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      {selected ? <Icon icon={Check} size="xs" tone="onPrimary" /> : icon ? <Icon icon={icon} size="xs" tone="muted" /> : null}
      <Text style={[theme.type.label, { color: selected ? theme.colors.primaryForeground : theme.colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------------------------- fields

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  /** A password field gets a show / hide button. */
  revealable?: boolean;
}

export function TextField({ label, error, hint, revealable = false, style, secureTextEntry, ...input }: TextFieldProps) {
  const theme = useTheme();
  const styles = useStyles();
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[theme.type.label, { color: theme.colors.foreground }]}>{label}</Text>
      <View style={[styles.inputBox, focused && styles.inputFocused, error ? styles.inputError : null, input.multiline && styles.multilineBox]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.mutedForeground}
          secureTextEntry={secureTextEntry && !shown}
          style={[styles.input, theme.type.body, input.multiline && styles.multiline, style]}
          {...input}
          onFocus={(event) => {
            setFocused(true);
            input.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            input.onBlur?.(event);
          }}
        />
        {revealable && secureTextEntry ? (
          <Pressable accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} onPress={() => setShown((value) => !value)} style={styles.inputAction}>
            <Icon icon={shown ? EyeOff : Eye} size="md" tone="muted" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.inline}>
          <Icon icon={AlertCircle} size="sm" tone="destructive" />
          <AppText variant="caption" tone="danger" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/** A search box: the search icon, the text, a clear button. Searching starts on the keyboard's search key. */
export function SearchField({
  label,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  ...input
}: Omit<TextInputProps, 'onSubmitEditing'> & { label: string; value: string; onChangeText: (text: string) => void; onSubmit: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.inputBox, styles.search]}>
      <Icon icon={Search} size="md" tone="muted" />
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder ?? label}
        placeholderTextColor={theme.colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        style={[styles.input, theme.type.body]}
        {...input}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} style={styles.inputAction}>
          <Icon icon={X} size="md" tone="muted" />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------- cards and rows

export function Card({ title, icon, action, children, style }: { title?: string; icon?: IconComponent; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.cardHead}>
          {icon ? <Icon icon={icon} size="sm" tone="muted" /> : null}
          <AppText accessibilityRole="header" variant="heading" style={styles.flex}>
            {title}
          </AppText>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A label on the left, its value on the right. The value wraps under a long label instead of being cut. */
export function Row({ label, value, strong = false, icon }: { label: string; value: string; strong?: boolean; icon?: IconComponent }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {icon ? <Icon icon={icon} size="sm" tone="muted" /> : null}
      <AppText tone={strong ? 'default' : 'muted'} weight={strong ? 'semibold' : undefined} style={styles.rowLabel}>
        {label}
      </AppText>
      <AppText weight={strong ? 'semibold' : 'medium'} style={styles.rowValue}>
        {value}
      </AppText>
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <AppText accessibilityRole="header" variant="heading" style={styles.flex}>
        {title}
      </AppText>
      {action}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  leading?: ReactNode;
  /** On the right of the title: an amount, a badge. */
  trailing?: ReactNode;
  /** Under the text: badges. */
  footer?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/** One record in a list: a card that opens it, with a chevron. */
export function ListRow({ title, subtitle, meta, leading, trailing, footer, onPress, accessibilityLabel }: ListRowProps) {
  const theme = useTheme();
  const styles = useStyles();
  const body = (
    <>
      {leading}
      <View style={styles.listText}>
        <View style={styles.listTop}>
          <AppText weight="semibold" style={styles.flex} numberOfLines={2}>
            {title}
          </AppText>
          {trailing}
        </View>
        {subtitle ? (
          <AppText variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
        {meta ? (
          <AppText variant="caption" tone="muted">
            {meta}
          </AppText>
        ) : null}
        {footer}
      </View>
      {onPress ? <Icon icon={ChevronRight} size="md" tone="muted" /> : null}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      android_ripple={{ color: theme.colors.border }}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressedRow]}
    >
      {body}
    </Pressable>
  );
}

/** A small picture with a fallback: never an empty grey box. `children` is the image when there is one. */
export function Thumb({ size = 56, icon, children }: { size?: number; icon: IconComponent; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.muted, alignItems: 'center', justifyContent: 'center' }}>
      {children ?? <Icon icon={icon} size={size >= 56 ? 'lg' : 'md'} tone="muted" />}
    </View>
  );
}

/** One number on the dashboard: an icon in a tinted circle, the value, its label. Tapping opens the list behind it. */
export function StatCard({ label, value, icon, tone, onPress }: { label: string; value: string; icon: IconComponent; tone?: Tone; onPress?: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const tint = tone ? theme.tones[tone] : null;
  const body = (
    <>
      <View style={[styles.statIcon, { backgroundColor: tint ? tint.soft : theme.colors.muted }]}>
        <Icon icon={icon} size="md" color={tint ? tint.solid : theme.colors.foreground} />
      </View>
      <AppText variant="title" weight="bold" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.stat}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      android_ripple={{ color: theme.colors.border }}
      style={({ pressed }) => [styles.stat, pressed && styles.pressedRow]}
    >
      {body}
    </Pressable>
  );
}

/** A status pill: a coloured dot (or icon) and the word. Colour is never the only signal. */
export function StatusBadge({ label, tone, icon }: { label: string; tone: Tone; icon?: IconComponent }) {
  const theme = useTheme();
  const styles = useStyles();
  const colors = theme.tones[tone];
  return (
    <View accessible accessibilityLabel={label} style={[styles.badgePill, { backgroundColor: colors.soft }]}>
      {icon ? <Icon icon={icon} size="xs" color={colors.solid} /> : <View style={[styles.dot, { backgroundColor: colors.solid }]} />}
      <Text style={[theme.type.caption, theme.weight.medium, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------- states

/** Placeholders the shape of what loads: never a blank screen, never a lone spinner. */
export function LoadingState({ rows = 3, kind = 'card' }: { rows?: number; kind?: 'card' | 'row' }) {
  const styles = useStyles();
  return (
    // A list row skeleton sits inside the list's own padding.
    <View accessibilityLabel="Loading" accessible style={kind === 'row' ? styles.skeletonList : styles.content}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={kind === 'row' ? styles.skeletonRow : styles.skeleton}>
          <View style={styles.skeletonDot} />
          <View style={styles.flex}>
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, styles.skeletonShort]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export const Skeleton = LoadingState;

export function EmptyState({ title, text, icon = Inbox, action }: { title: string; text?: string; icon?: IconComponent; action?: { label: string; onPress: () => void } }) {
  const styles = useStyles();
  return (
    <View style={styles.state}>
      <View style={styles.stateIcon}>
        <Icon icon={icon} size="xl" tone="muted" />
      </View>
      <AppText variant="heading" style={styles.center}>
        {title}
      </AppText>
      {text ? (
        <AppText tone="muted" style={styles.center}>
          {text}
        </AppText>
      ) : null}
      {action ? <Button title={action.label} kind="outline" block={false} onPress={action.onPress} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.state}>
      <Icon icon={AlertCircle} size="xl" tone="destructive" />
      <AppText accessibilityRole="alert" style={styles.center}>
        {message}
      </AppText>
      {onRetry ? <Button title="Try again" kind="outline" block={false} onPress={onRetry} /> : null}
    </View>
  );
}

export type BannerTone = 'info' | 'warning' | 'danger' | 'success' | 'offline';

const BANNER: Record<BannerTone, { tone: Tone; icon: IconComponent }> = {
  info: { tone: 'info', icon: Info },
  warning: { tone: 'warning', icon: AlertTriangle },
  danger: { tone: 'destructive', icon: AlertCircle },
  success: { tone: 'success', icon: CheckCircle },
  offline: { tone: 'neutral', icon: WifiOff },
};

/** A message across a screen: offline, waiting changes, a refusal, a success. An optional action on its right. */
export function Banner({ text, tone = 'warning', icon, action }: { text: string; tone?: BannerTone; icon?: IconComponent; action?: { label: string; onPress: () => void } }) {
  const theme = useTheme();
  const styles = useStyles();
  const look = BANNER[tone];
  const colors = theme.tones[look.tone];
  return (
    <View style={[styles.banner, { backgroundColor: colors.soft, borderColor: colors.solid }]}>
      <Icon icon={icon ?? look.icon} size="md" color={colors.solid} />
      <Text accessibilityRole="alert" style={[theme.type.label, theme.weight.regular, styles.flex, { color: colors.text }]}>
        {text}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} style={styles.bannerAction}>
          <Text style={[theme.type.label, theme.weight.semibold, { color: theme.colors.link }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The name since Sprint 9 B4: a warning, a refusal or an information line. */
export function Notice({ text, tone = 'warning' }: { text: string; tone?: 'warning' | 'danger' | 'info' | 'success' }) {
  return <Banner text={text} tone={tone} />;
}

// ---------------------------------------------------------------------------------------------------------------- sheet

/** A sheet from the bottom over a dimmed screen. The back button and a tap outside close it, unless it is busy. */
export function Sheet({ visible, title, onClose, children, busy = false }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => (busy ? undefined : onClose())} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.flex} onPress={() => (busy ? undefined : onClose())} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { paddingBottom: theme.space.lg + (insets?.bottom ?? 0) }]}>
            <View style={styles.grabber} />
            <AppText accessibilityRole="header" variant="title">
              {title}
            </AppText>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** "Are you sure?" in the thumb zone: the action, and a way back. */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  busy = false,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onCancel} busy={busy}>
      {message ? <AppText tone="muted">{message}</AppText> : null}
      <Button title={confirmLabel} kind={destructive ? 'destructive' : 'primary'} onPress={onConfirm} busy={busy} />
      <Button title="Not now" kind="ghost" onPress={onCancel} disabled={busy} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------- header

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  /** Shows the back arrow. */
  onBack?: () => void;
  /** Icon buttons on the right. */
  actions?: ReactNode;
  /** Under the title: the store switcher. */
  below?: ReactNode;
}

/** The bar at the top of every screen, below the status bar. */
export function AppHeader({ title, subtitle, onBack, actions, below }: AppHeaderProps) {
  const styles = useStyles();
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <View style={[styles.header, { paddingTop: insets?.top ?? 0 }]}>
      <View style={[styles.headerRow, onBack ? null : styles.headerNoBack]}>
        {onBack ? <IconButton icon={ArrowLeft} label="Back" onPress={onBack} /> : null}
        <View style={styles.flex}>
          <AppText accessibilityRole="header" variant="title" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions}
      </View>
      {below ? <View style={styles.headerBelow}>{below}</View> : null}
    </View>
  );
}

/** The current store as a chip that opens the store switcher: the name, the role, a chevron. */
export function SwitcherChip({ icon, label, detail, onPress }: { icon: IconComponent; label: string; detail?: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${detail ? `, ${detail}` : ''}. Change store`}
      onPress={onPress}
      style={({ pressed }) => [styles.switcher, pressed && styles.pressed]}
    >
      <Icon icon={icon} size="sm" tone="default" />
      <AppText weight="semibold" numberOfLines={1} style={styles.switcherName}>
        {label}
      </AppText>
      {detail ? (
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {detail}
        </AppText>
      ) : null}
      <Icon icon={ChevronDown} size="sm" tone="muted" />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------------------------- styles

const useStyles = makeStyles((t) => {
  const field: TextStyle = { flex: 1, minHeight: t.tap, paddingHorizontal: t.space.md, color: t.colors.foreground };
  return {
    flex: { flex: 1 },
    center: { textAlign: 'center' },
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: t.space.lg, gap: t.space.md, paddingBottom: t.space.xxl },
    footer: {
      gap: t.space.sm,
      paddingHorizontal: t.space.lg,
      paddingTop: t.space.md,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
      backgroundColor: t.colors.card,
      ...t.shadow.lg,
    },
    button: {
      minHeight: t.tap,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.sm,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.transparent,
    },
    buttonSm: { paddingHorizontal: t.space.md },
    inline: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: t.space.xs },
    primary: { backgroundColor: t.colors.primary, ...t.shadow.sm },
    secondary: { backgroundColor: t.colors.secondary },
    outline: { backgroundColor: t.colors.card, borderColor: t.colors.input },
    ghost: { backgroundColor: t.colors.transparent },
    destructive: { backgroundColor: t.colors.destructive },
    pressed: { opacity: 0.85 },
    pressedRow: { backgroundColor: t.colors.background },
    off: { opacity: 0.5 },
    iconButton: { width: t.tap, height: t.tap, borderRadius: t.radius.full, alignItems: 'center', justifyContent: 'center' },
    badge: {
      position: 'absolute',
      top: 6,
      right: 4,
      minWidth: 20,
      paddingHorizontal: t.space.xs,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.destructive,
      alignItems: 'center',
    },
    badgeText: { color: t.colors.destructiveForeground },
    chip: {
      minHeight: t.tap,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.xs,
      paddingHorizontal: t.space.md,
      borderRadius: t.radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
    },
    chipSelected: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
    field: { gap: t.space.xs },
    inputBox: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.colors.input,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.card,
    },
    inputFocused: { borderColor: t.colors.link, borderWidth: 2 },
    inputError: { borderColor: t.tones.destructive.solid, borderWidth: 2 },
    multilineBox: { alignItems: 'flex-start' },
    input: field,
    multiline: { minHeight: 96, paddingTop: t.space.sm, textAlignVertical: 'top' },
    inputAction: { width: t.tap, height: t.tap, alignItems: 'center', justifyContent: 'center' },
    search: { paddingLeft: t.space.md },
    card: {
      gap: t.space.md,
      padding: t.space.lg,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      ...t.shadow.sm,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: t.space.md, rowGap: t.space.xxs },
    rowLabel: { flexShrink: 1, flexGrow: 1 },
    rowValue: { flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingTop: t.space.sm },
    listRow: {
      minHeight: t.tap,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.md,
      padding: t.space.md,
      marginBottom: t.space.sm,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      ...t.shadow.sm,
    },
    listText: { flex: 1, gap: t.space.xs },
    listTop: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.sm },
    stat: {
      flexGrow: 1,
      flexBasis: '46%',
      gap: t.space.xs,
      padding: t.space.md,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      ...t.shadow.sm,
    },
    statIcon: { width: 36, height: 36, borderRadius: t.radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: t.space.xs },
    badgePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: t.space.xs + 2, paddingHorizontal: t.space.sm + 2, paddingVertical: t.space.xxs + 1, borderRadius: t.radius.full },
    dot: { width: 8, height: 8, borderRadius: 4 },
    skeleton: { flexDirection: 'row', gap: t.space.md, padding: t.space.lg, borderRadius: t.radius.xl, backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.border },
    skeletonList: { gap: t.space.sm },
    skeletonRow: { flexDirection: 'row', gap: t.space.md, padding: t.space.md, borderRadius: t.radius.xl, backgroundColor: t.colors.card },
    skeletonDot: { width: 40, height: 40, borderRadius: t.radius.lg, backgroundColor: t.colors.muted },
    skeletonLine: { height: 12, borderRadius: t.radius.sm, backgroundColor: t.colors.muted, marginBottom: t.space.sm },
    skeletonShort: { width: '55%' },
    state: { padding: t.space.xl, gap: t.space.md, alignItems: 'center' },
    stateIcon: { width: 72, height: 72, borderRadius: t.radius.full, backgroundColor: t.colors.muted, alignItems: 'center', justifyContent: 'center' },
    banner: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, padding: t.space.md, borderRadius: t.radius.lg, borderLeftWidth: 4 },
    bannerAction: { minHeight: t.tap, justifyContent: 'center', paddingHorizontal: t.space.xs },
    scrim: { flex: 1, backgroundColor: t.colors.scrim },
    sheet: {
      gap: t.space.md,
      padding: t.space.lg,
      borderTopLeftRadius: t.radius.xxl,
      borderTopRightRadius: t.radius.xxl,
      backgroundColor: t.colors.card,
    },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.colors.border },
    header: { backgroundColor: t.colors.card, borderBottomWidth: 1, borderBottomColor: t.colors.border },
    headerRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: t.space.xs, paddingHorizontal: t.space.sm },
    headerNoBack: { paddingLeft: t.space.lg },
    headerBelow: { paddingHorizontal: t.space.lg, paddingBottom: t.space.sm },
    switcher: {
      minHeight: t.tap,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      paddingHorizontal: t.space.md,
      borderRadius: t.radius.full,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.background,
    },
    switcherName: { flexShrink: 1 },
  };
});
