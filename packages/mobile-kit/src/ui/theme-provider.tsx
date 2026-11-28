import { useFonts } from 'expo-font';
import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { APP_PALETTES, FONT_FAMILIES, themeFor, type Theme } from '../theme';

/*
 * The theme in use: the app's palette (theme.ts, APP_PALETTES), light or dark as the phone is set, Poppins once loaded. Without a provider (a test of one
 * screen) the seller palette in light, in the system font.
 */

const ThemeContext = createContext<Theme | null>(null);

// One file per weight, so only these four go into the app (the package's index holds all 18).
const POPPINS = {
  [FONT_FAMILIES.regular]: require('@expo-google-fonts/poppins/400Regular/Poppins_400Regular.ttf'),
  [FONT_FAMILIES.medium]: require('@expo-google-fonts/poppins/500Medium/Poppins_500Medium.ttf'),
  [FONT_FAMILIES.semibold]: require('@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf'),
  [FONT_FAMILIES.bold]: require('@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf'),
};

/** Loads Poppins once (the system font shows until then: nothing waits for it) and follows the phone's light or dark setting. */
export function ThemeProvider({ app, children }: { app: keyof typeof APP_PALETTES; children: ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [loaded] = useFonts(POPPINS);
  return <ThemeContext.Provider value={themeFor(APP_PALETTES[app], scheme, loaded)}>{children}</ThemeContext.Provider>;
}

/** For a test or a preview: a fixed theme, no font loading. */
export function FixedTheme({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext) ?? themeFor(APP_PALETTES.seller, 'light', false);
}

/**
 * The themed StyleSheet: `const useStyles = makeStyles((t) => ({ ... }))` beside a component, `const styles = useStyles()` inside it. The sheet is made once
 * per theme (light, dark, fonts loaded), not on every render.
 */
export function makeStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(factory: (theme: Theme) => T): () => T {
  const sheets = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let sheet = sheets.get(theme);
    if (!sheet) {
      sheet = StyleSheet.create(factory(theme));
      sheets.set(theme, sheet);
    }
    return sheet;
  };
}
