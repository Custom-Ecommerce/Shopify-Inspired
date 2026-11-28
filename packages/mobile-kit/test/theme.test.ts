import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APP_PALETTES, PALETTES, themeFor, type PaletteName, type Scheme, type Theme, type Tone } from '../src/theme';

/*
 * S9-UI: the theme is ONE file. (1) No colour is written anywhere else in the two apps or this package. (2) Every colour pair the screens use passes WCAG
 * AA in every palette and scheme: 4.5:1 for text, 3:1 for icons, dots and field edges.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SOURCES = ['packages/mobile-kit/src', 'apps/seller/mobile/app', 'apps/seller/mobile/src', 'apps/admin/mobile/app', 'apps/admin/mobile/src'];
const THEME_FILE = 'packages/mobile-kit/src/theme.ts';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });
}

/** CSS colour names a style could use. */
const NAMED = [
  'white', 'black', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey', 'silver', 'maroon', 'navy', 'teal', 'olive', 'lime', 'aqua',
  'fuchsia', 'brown', 'gold', 'cyan', 'magenta', 'transparent', 'darkgray', 'lightgray', 'darkgrey', 'lightgrey', 'crimson', 'tomato', 'salmon', 'indigo', 'violet',
];

const RULES: [string, RegExp][] = [
  ['hex colour', /['"`]#[0-9a-fA-F]{3,8}['"`]/],
  ['rgb()/rgba()', /\brgba?\(/],
  ['hsl()/hsla()', /\bhsla?\(/],
  ['oklch()', /\boklch\(/],
  ['named colour', new RegExp(`\\b(?:[cC]olor|[tT]int|backgroundColor|borderColor|[a-zA-Z]*Color)\\s*[:=]\\s*\\{?\\s*['"](?:${NAMED.join('|')})['"]`, 'i')],
];

/** The offending lines of one file. */
export function literalsIn(source: string): string[] {
  return source
    .split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .flatMap(({ line, i }) => RULES.filter(([, rule]) => rule.test(line)).map(([name]) => `${i + 1}: ${name}: ${line.trim()}`));
}

describe('one theme file', () => {
  it('finds a colour written in a style, so the check below can fail', () => {
    expect(literalsIn("const s = { color: '#fff' };")).toHaveLength(1);
    expect(literalsIn("<ActivityIndicator color=\"white\" />")).toHaveLength(1);
    expect(literalsIn("const s = { backgroundColor: 'rgba(0,0,0,0.5)' };")).toHaveLength(1);
    expect(literalsIn('const s = { borderColor: "transparent" };')).toHaveLength(1);
    expect(literalsIn("const label = 'Order #12 in Lahore';")).toHaveLength(0);
  });

  it('has no colour outside theme.ts in the apps and this package', () => {
    const found: string[] = [];
    for (const dir of SOURCES) {
      for (const path of files(join(ROOT, dir))) {
        const name = relative(ROOT, path).replace(/\\/g, '/');
        if (name === THEME_FILE) continue;
        for (const hit of literalsIn(readFileSync(path, 'utf8'))) found.push(`${name}:${hit}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('lets each app pick its palette in one place', () => {
    expect(APP_PALETTES).toEqual({ seller: 'markaz', admin: 'markazAdmin' });
    expect(themeFor('markaz', 'light', false)).toBe(themeFor('markaz', 'light', false));
    expect(themeFor('markaz', 'light', true).type.body.fontFamily).toBe('Poppins_400Regular');
    expect(themeFor('markaz', 'light', false).type.body.fontFamily).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------- contrast

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TONES: Tone[] = ['success', 'warning', 'info', 'destructive', 'neutral'];

/** [what, foreground, background, minimum] for every pair a screen draws. */
function pairs(t: Theme): [string, string, string, number][] {
  const c = t.colors;
  const text = 4.5;
  const graphic = 3;
  return [
    ['text on background', c.foreground, c.background, text],
    ['text on card', c.cardForeground, c.card, text],
    ['muted text on background', c.mutedForeground, c.background, text],
    ['muted text on card', c.mutedForeground, c.card, text],
    ['link on card', c.link, c.card, text],
    ['link on background', c.link, c.background, text],
    ['primary button text', c.primaryForeground, c.primary, text],
    ['secondary button text', c.secondaryForeground, c.secondary, text],
    ['destructive button text', c.destructiveForeground, c.destructive, text],
    ['error text on card', t.tones.destructive.solid, c.card, text],
    ['error text on background', t.tones.destructive.solid, c.background, text],
    ...TONES.map((tone): [string, string, string, number] => [`${tone} badge text`, t.tones[tone].text, t.tones[tone].soft, text]),
    ...TONES.map((tone): [string, string, string, number] => [`${tone} dot and icon on its tint`, t.tones[tone].solid, t.tones[tone].soft, graphic]),
    ...TONES.map((tone): [string, string, string, number] => [`${tone} icon on the background`, t.tones[tone].solid, c.background, graphic]),
    ['text field edge', c.input, c.card, graphic],
    ['icon on the active tab pill', c.primaryForeground, c.primary, graphic],
    ['inactive tab icon', c.mutedForeground, c.card, graphic],
    ['icon on a muted tile', c.mutedForeground, c.muted, graphic],
    ['stat icon on a muted circle', c.foreground, c.muted, graphic],
  ];
}

const THEMES = (Object.keys(PALETTES) as PaletteName[]).flatMap((name) => (['light', 'dark'] as Scheme[]).map((scheme) => themeFor(name, scheme, false)));

describe('contrast, WCAG AA', () => {
  it('computes the WCAG ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });

  it.each(THEMES.map((t) => [`${t.name} ${t.scheme}`, t] as const))('%s passes for every pair the screens use', (_name, t) => {
    const failing = pairs(t)
      .map(([what, fg, bg, min]) => ({ what, ratio: Math.round(contrast(fg, bg) * 100) / 100, min }))
      .filter((pair) => pair.ratio < pair.min);
    expect(failing).toEqual([]);
  });
});
