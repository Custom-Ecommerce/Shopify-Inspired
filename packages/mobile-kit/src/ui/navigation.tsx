import { useMemo, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { AppHeader, Icon, type IconComponent } from './primitives';
import { makeStyles, useTheme } from './theme-provider';

/*
 * The navigators' look, from the theme: the bottom tabs (icon and short label, the active one on a primary pill, as the web sidebar marks the active
 * page) and the header of every stacked screen. Expo Router passes these through as options.
 */

/** The icon of a tab: on a primary pill when it is the open tab. */
export function TabIcon({ icon, focused }: { icon: IconComponent; focused: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.pill, focused && styles.pillActive]}>
      <Icon icon={icon} size="md" tone={focused ? 'onPrimary' : 'muted'} />
    </View>
  );
}

function TabLabel({ focused, children }: { focused: boolean; children: ReactNode }) {
  const theme = useTheme();
  return (
    // Five tabs share 360 dp: a long word (Customers) is set a little smaller rather than cut.
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      style={[
        theme.type.caption,
        { fontSize: theme.type.caption.fontSize! - 1 },
        focused ? theme.weight.semibold : theme.weight.medium,
        { color: focused ? theme.colors.foreground : theme.colors.mutedForeground },
      ]}
    >
      {children}
    </Text>
  );
}

/** The options of one tab: its title and its icon. */
export const tab = (title: string, icon: IconComponent) => ({
  title,
  tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon icon={icon} focused={focused} />,
  tabBarLabel: ({ focused }: { focused: boolean }) => <TabLabel focused={focused}>{title}</TabLabel>,
  tabBarAccessibilityLabel: title,
});

/** The tab bar's own options. */
export function useTabBarOptions() {
  const theme = useTheme();
  return useMemo(
    () => ({
      tabBarActiveTintColor: theme.colors.foreground,
      tabBarInactiveTintColor: theme.colors.mutedForeground,
      tabBarStyle: { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border, minHeight: 64 },
      tabBarItemStyle: { minHeight: theme.tap, paddingVertical: theme.space.xs, paddingHorizontal: 0 },
      sceneStyle: { backgroundColor: theme.colors.background },
    }),
    [theme],
  );
}

interface HeaderInput {
  options: { title?: string };
  navigation: { goBack: () => void };
  back?: unknown;
}

/** A stacked screen's header: its title, and the back arrow when there is somewhere to go back to. */
export function useStackOptions() {
  const theme = useTheme();
  return useMemo(
    () => ({
      header: ({ options, navigation, back }: HeaderInput) => <AppHeader title={options.title ?? ''} onBack={back ? () => navigation.goBack() : undefined} />,
      contentStyle: { backgroundColor: theme.colors.background },
    }),
    [theme],
  );
}

const useStyles = makeStyles((t) => ({
  pill: { width: 52, height: 30, borderRadius: t.radius.full, alignItems: 'center', justifyContent: 'center' },
  pillActive: { backgroundColor: t.colors.primary },
}));
