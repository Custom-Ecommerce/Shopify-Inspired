import type { TextStyle, ViewStyle } from 'react-native';

/*
 * THE ONE THEME FILE of both phone apps (Sprint 9 S9-UI). Every colour, font, size, spacing, radius and shadow is here and nowhere else: a test fails on a
 * colour written anywhere else (test/theme.test.ts). To change the look, edit this file only.
 *
 * The values are the web apps' design tokens (apps/seller/frontend/app/globals.css and apps/admin/frontend/app/globals.css), converted once from oklch to
 * hex (React Native has no oklch). Where a web pair fails WCAG AA as the phone uses it, the value is the admin console's contrast fix of the same token
 * (SB-9), marked "AA" below; test/theme.test.ts computes every pair the screens use, in both palettes.
 */

// ---------------------------------------------------------------------------------------------------------------- palettes

export interface Palette {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  /** Hairlines between and around cards: decoration only. */
  border: string;
  /** The edge of a text field: 3:1 against the card (WCAG 1.4.11). */
  input: string;
  ring: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  info: string;
  infoForeground: string;
  /** The brand colour as TEXT or a thin icon (links, the active tab label): readable on the card, unlike the light pink fill. */
  link: string;
  /** Behind a sheet. */
  scrim: string;
  shadow: string;
  transparent: string;
}

/** Optional soft tints and their text, where the web has its own (the admin console's --status-*). Otherwise they are mixed from the solid colour. */
type StatusOverrides = Partial<Record<Tone, { soft: string; text: string }>>;

interface PaletteSet {
  light: Palette;
  dark: Palette;
  status?: { light: StatusOverrides; dark: StatusOverrides };
}

const common = { scrim: '#00000073', shadow: '#000000', transparent: '#00000000' } as const;

/** The seller web app (apps/seller/frontend/app/globals.css). */
const markaz: PaletteSet = {
  light: {
    ...common,
    background: '#f7f9fa',
    foreground: '#333333',
    card: '#ffffff',
    cardForeground: '#333333',
    primary: '#ffc0cb',
    primaryForeground: '#000000',
    secondary: '#87ceeb',
    secondaryForeground: '#000000',
    muted: '#ddd9c4',
    mutedForeground: '#6e6e6e',
    accent: '#ffff00',
    accentForeground: '#000000',
    destructive: '#cc3335', // AA: the web's #ef4444 gives white text 3.8:1
    destructiveForeground: '#ffffff',
    border: '#d4d4d4',
    input: '#8c8c8c', // AA: the web's #d4d4d4 is 1.5:1 as a field edge
    ring: '#ffc0cb',
    success: '#059467',
    successForeground: '#ffffff',
    warning: '#b45309', // AA: the web's #db7706 is 2.7:1 as a dot on its tint; the same amber, darker
    warningForeground: '#412006',
    info: '#2463eb',
    infoForeground: '#ffffff',
    link: '#ba3f61', // the same hue as primary, dark enough to read (the admin console's primary)
  },
  dark: {
    ...common,
    background: '#1a1d23',
    foreground: '#e5e5e5',
    card: '#2f3436',
    cardForeground: '#e5e5e5',
    primary: '#ff99cc',
    primaryForeground: '#000000',
    secondary: '#33cc33',
    secondaryForeground: '#000000',
    muted: '#444444',
    mutedForeground: '#a3a3a3',
    accent: '#87ceeb',
    accentForeground: '#000000',
    destructive: '#fd736c', // AA (admin console dark)
    destructiveForeground: '#000000',
    border: '#444444',
    input: '#868686', // AA (admin console dark)
    ring: '#ff99cc',
    success: '#36d399',
    successForeground: '#0f0f0f',
    warning: '#fbbd23',
    warningForeground: '#2f1704',
    info: '#61a6fa',
    infoForeground: '#0f1729',
    link: '#ff99cc',
  },
};

/** The admin console (apps/admin/frontend/app/globals.css): its own contrast-fixed rose primary and status pairs. */
const markazAdmin: PaletteSet = {
  light: {
    ...common,
    background: '#f7f9fa',
    foreground: '#333333',
    card: '#ffffff',
    cardForeground: '#333333',
    primary: '#ba3f61',
    primaryForeground: '#ffffff',
    secondary: '#87ceeb',
    secondaryForeground: '#000000',
    muted: '#ddd9c4',
    mutedForeground: '#5b5b5b',
    accent: '#ffff00',
    accentForeground: '#000000',
    destructive: '#cc3335',
    destructiveForeground: '#ffffff',
    border: '#d4d4d4',
    input: '#8c8c8c',
    ring: '#ffc0cb',
    success: '#079669',
    successForeground: '#ffffff',
    warning: '#b45309', // AA: the console's #e17100 is 2.8:1 as a dot on its tint
    warningForeground: '#000000',
    info: '#2463eb', // the console has no info token: the seller app's
    infoForeground: '#ffffff',
    link: '#ba3f61',
  },
  dark: {
    ...common,
    background: '#1a1d23',
    foreground: '#e5e5e5',
    card: '#2f3436',
    cardForeground: '#e5e5e5',
    primary: '#ff99cc',
    primaryForeground: '#000000',
    secondary: '#33cc33',
    secondaryForeground: '#000000',
    muted: '#444444',
    mutedForeground: '#b4b4b4',
    accent: '#87ceeb',
    accentForeground: '#000000',
    destructive: '#fd736c',
    destructiveForeground: '#000000',
    border: '#444444',
    input: '#868686',
    ring: '#ff99cc',
    success: '#00d492',
    successForeground: '#000000',
    warning: '#ffb900',
    warningForeground: '#000000',
    info: '#61a6fa',
    infoForeground: '#0f1729',
    link: '#ff99cc',
  },
  status: {
    light: {
      success: { soft: '#d7f7e7', text: '#005d3d' },
      warning: { soft: '#fff0cc', text: '#754700' },
      destructive: { soft: '#ffe7e4', text: '#9b1e22' },
      neutral: { soft: '#eeeeee', text: '#484848' },
    },
    dark: {
      success: { soft: '#123626', text: '#8ee3bb' },
      warning: { soft: '#392c0c', text: '#f3d086' },
      destructive: { soft: '#47211e', text: '#ffb7b0' },
      neutral: { soft: '#2e2e2e', text: '#cecece' },
    },
  },
};

export const PALETTES = { markaz, markazAdmin } as const;
export type PaletteName = keyof typeof PALETTES;

/** WHICH LOOK EACH APP HAS. One line per app: point it at another palette above to re-theme that app. */
export const APP_PALETTES: Record<'seller' | 'admin', PaletteName> = { seller: 'markaz', admin: 'markazAdmin' };

// ---------------------------------------------------------------------------------------------------------------- status tones

export type Tone = 'success' | 'warning' | 'info' | 'destructive' | 'neutral';

export interface ToneColors {
  /** The dot, the icon. */
  solid: string;
  /** The pill and banner background. */
  soft: string;
  /** Text on the soft background. */
  text: string;
}

/** The web's StatusBadge mapping (apps/seller/frontend/components/dashboard/shared/StatusBadge.tsx). */
export const ORDER_STATUS_TONES: Readonly<Record<string, Tone>> = {
  pending: 'warning',
  confirmed: 'info',
  processing: 'warning',
  dispatched: 'info',
  delivered: 'success',
  cancelled: 'destructive',
  returned: 'neutral',
};

export const STOCK_TONES: Readonly<Record<string, Tone>> = { in_stock: 'success', low_stock: 'warning', out_of_stock: 'destructive' };

export const PAYMENT_TONES: Readonly<Record<string, Tone>> = { unpaid: 'warning', collected: 'success', paid: 'success' };

export const toneOf = (map: Readonly<Record<string, Tone>>, value: string | null | undefined): Tone => (value ? (map[value] ?? 'neutral') : 'neutral');

// ---------------------------------------------------------------------------------------------------------------- sizes

/** A 4 dp grid. */
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 } as const;

/** The web's --radius is 0.5rem = 8 dp (lg); the others are its calc() steps. */
export const radius = { sm: 4, md: 6, lg: 8, xl: 12, xxl: 16, full: 999 } as const;

/** Fitts: nothing tappable under 48 dp. */
export const MIN_TAP_TARGET = 48;
export const MIN_SCREEN_WIDTH = 360;

export const iconSize = { xs: 14, sm: 16, md: 20, lg: 24, xl: 32, xxl: 44 } as const;
export type IconSize = keyof typeof iconSize;

// ---------------------------------------------------------------------------------------------------------------- type

/** Poppins, as on the web, in the four weights the web uses. The names are the keys the fonts are loaded under (ui/theme-provider.tsx). */
export const FONT_FAMILIES = { regular: 'Poppins_400Regular', medium: 'Poppins_500Medium', semibold: 'Poppins_600SemiBold', bold: 'Poppins_700Bold' } as const;
export type FontWeightName = keyof typeof FONT_FAMILIES;

const WEIGHTS: Record<FontWeightName, TextStyle['fontWeight']> = { regular: '400', medium: '500', semibold: '600', bold: '700' };

export type TypeVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';

/** The scale. No line height is fixed, so text grows with the phone's font size and never clips. */
const SCALE: Record<TypeVariant, { size: number; weight: FontWeightName }> = {
  display: { size: 26, weight: 'bold' },
  title: { size: 20, weight: 'semibold' },
  heading: { size: 16, weight: 'semibold' },
  body: { size: 15, weight: 'regular' },
  label: { size: 14, weight: 'medium' },
  caption: { size: 13, weight: 'regular' },
};

// ---------------------------------------------------------------------------------------------------------------- shadows

/** The web's --shadow-sm and --shadow-md. */
const SHADOWS = {
  none: {},
  sm: { boxShadow: '0px 1px 3px 0px rgba(0,0,0,0.10), 0px 1px 2px -1px rgba(0,0,0,0.10)' },
  md: { boxShadow: '0px 1px 3px 0px rgba(0,0,0,0.10), 0px 2px 4px -1px rgba(0,0,0,0.10)' },
  lg: { boxShadow: '0px 1px 3px 0px rgba(0,0,0,0.10), 0px 8px 10px -1px rgba(0,0,0,0.10)' },
} satisfies Record<string, ViewStyle>;

// ---------------------------------------------------------------------------------------------------------------- the theme object

export type Scheme = 'light' | 'dark';

export interface Theme {
  name: PaletteName;
  scheme: Scheme;
  colors: Palette;
  tones: Record<Tone, ToneColors>;
  /** Text styles of the scale, in Poppins once it is loaded, the system font before. */
  type: Record<TypeVariant, TextStyle>;
  /** One weight, for a text that changes only its weight. */
  weight: Record<FontWeightName, TextStyle>;
  space: typeof spacing;
  radius: typeof radius;
  shadow: typeof SHADOWS;
  iconSize: typeof iconSize;
  tap: number;
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];
}

/** `share` of `color` over `base`, as a hex colour: the web's tone/12 on a card. */
export function mix(color: string, base: string, share: number): string {
  const a = channels(color);
  const b = channels(base);
  return '#' + a.map((value, i) => Math.round(value * share + b[i]! * (1 - share)).toString(16).padStart(2, '0')).join('');
}

function tonesOf(palette: Palette, overrides: StatusOverrides = {}): Record<Tone, ToneColors> {
  const tone = (solid: string, key: Tone): ToneColors => ({
    solid,
    soft: overrides[key]?.soft ?? mix(solid, palette.card, 0.14),
    // The web puts foreground text on the tint; the dot carries the hue.
    text: overrides[key]?.text ?? palette.foreground,
  });
  return {
    success: tone(palette.success, 'success'),
    warning: tone(palette.warning, 'warning'),
    info: tone(palette.info, 'info'),
    destructive: tone(palette.destructive, 'destructive'),
    neutral: { solid: palette.mutedForeground, soft: overrides.neutral?.soft ?? mix(palette.mutedForeground, palette.card, 0.12), text: overrides.neutral?.text ?? palette.foreground },
  };
}

const built = new Map<string, Theme>();

/** The theme of one palette and scheme. The same object for the same inputs, so styles made from it are cached. */
export function themeFor(name: PaletteName, scheme: Scheme, fontsLoaded: boolean): Theme {
  const id = `${name}:${scheme}:${fontsLoaded}`;
  const cached = built.get(id);
  if (cached) return cached;
  const set = PALETTES[name];
  const colors = set[scheme];
  // With Poppins, the weight is in the family; a fontWeight next to it makes Android pick another face.
  const weight = (name: FontWeightName): TextStyle => (fontsLoaded ? { fontFamily: FONT_FAMILIES[name] } : { fontWeight: WEIGHTS[name] });
  const type = Object.fromEntries(
    (Object.keys(SCALE) as TypeVariant[]).map((variant) => [variant, { fontSize: SCALE[variant].size, color: colors.foreground, ...weight(SCALE[variant].weight) }]),
  ) as Record<TypeVariant, TextStyle>;
  const theme: Theme = {
    name,
    scheme,
    colors,
    tones: tonesOf(colors, set.status?.[scheme]),
    type,
    weight: { regular: weight('regular'), medium: weight('medium'), semibold: weight('semibold'), bold: weight('bold') },
    space: spacing,
    radius,
    shadow: SHADOWS,
    iconSize,
    tap: MIN_TAP_TARGET,
  };
  built.set(id, theme);
  return theme;
}
