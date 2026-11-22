import { z } from 'zod';

/*
 * Sprint 7 (S7-B7, D-115): what a seller may change in the Stiletto theme: two colours, a font from a short list, the home hero, the announcement bar and
 * four section switches. Stored in store.storefront.themeConfig and saved through the store settings group "themeConfig".
 *
 * Safety first: the seller never sends CSS. A colour is a hex value (normalised to #rrggbb), a font is a NAME from a whitelist that the theme maps to a fixed
 * font stack, and every text is plain text that the theme renders as a React text node. A link is an internal path or an https address. The schema is strict,
 * so an unknown key is a 400 that names it. Everything here is pure.
 */

// ---------------------------------------------------------------------------------------------------------- limits

export const THEME_HERO_TITLE_MAX = 80;
export const THEME_HERO_SUBTITLE_MAX = 160;
export const THEME_HERO_CTA_LABEL_MAX = 30;
export const THEME_HERO_CTA_LINK_MAX = 300;
export const THEME_ANNOUNCEMENT_MAX = 120;

/** The fonts a seller may name. `theme` keeps the theme's own fonts; the others map to the fixed stacks below. */
export const THEME_FONT_FAMILIES = ['theme', 'system', 'serif', 'rounded', 'mono'] as const;
export type ThemeFontFamily = (typeof THEME_FONT_FAMILIES)[number];

/** The font stacks, fixed here. Nothing a seller sends ever reaches a CSS value; only the name picks one. `theme` has no stack (the theme's own fonts stay). */
export const THEME_FONT_STACKS: Readonly<Record<Exclude<ThemeFontFamily, 'theme'>, string>> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  rounded: '"Trebuchet MS", "Segoe UI Rounded", "Arial Rounded MT Bold", Verdana, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace',
};

// ---------------------------------------------------------------------------------------------------------- colours

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NORMAL_HEX = /^#[0-9a-f]{6}$/;

/** A colour as #rrggbb in lower case, from #rgb or #rrggbb in any case (surrounding spaces ignored); null for anything else. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!HEX.test(text)) return null;
  const digits = text.slice(1).toLowerCase();
  const full = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  return '#' + full;
}

/** True for exactly a normalised colour (#rrggbb, lower case). The style builder accepts nothing else. */
export const isNormalizedHex = (value: unknown): value is string => typeof value === 'string' && NORMAL_HEX.test(value);

const hexSchema = (label: string) =>
  z
    .string({ error: label + ' must be a colour like #1a2b3c' })
    .transform((value, context) => {
      const hex = normalizeHexColor(value);
      if (hex === null) {
        context.addIssue({ code: 'custom', message: label + ' must be a colour like #1a2b3c' });
        return z.NEVER;
      }
      return hex;
    });

// ---------------------------------------------------------------------------------------------------------- text

const NO_HTML = /[<>]/;

/** One line of plain text: controls become spaces, runs of space one space; < and > are refused. An empty string or null clears it (null). */
function clearableLine(max: number, label: string) {
  return z
    .union([z.literal(''), z.null(), z.string({ error: label + ' must be text' })])
    .transform((value) => (value === null ? '' : value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()))
    .pipe(z.string().max(max, label + ' can be at most ' + max + ' characters').refine((value) => !NO_HTML.test(value), label + ' cannot contain < or >'))
    .transform((value) => (value === '' ? null : value));
}

/** A link: a path on this store ("/products", never "//host"), or a full https address. Nothing else (no javascript:, data:, http:, no user name). */
export function normalizeThemeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > THEME_HERO_CTA_LINK_MAX) return null;
  if (/[\u0000-\u001F\u007F\s\\<>"'`{}|^]/.test(text)) return null;
  if (text.startsWith('/')) return text.startsWith('//') ? null : text;
  if (!/^https:\/\/[^/]/i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
    return text;
  } catch {
    return null;
  }
}

const linkSchema = z
  .union([z.literal(''), z.null(), z.string({ error: 'the link must be text' })])
  .transform((value, context) => {
    if (value === '' || value === null) return null;
    const link = normalizeThemeLink(value);
    if (link === null) {
      context.addIssue({ code: 'custom', message: 'the link must start with / (a page of your store) or https://' });
      return z.NEVER;
    }
    return link;
  });

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
/** A reference to one of the store's own Media records (checked by the route); null removes it. */
const mediaRefSchema = z.union([z.null(), z.string().regex(OBJECT_ID, 'must be a media id')]);

// ---------------------------------------------------------------------------------------------------------- the fields

/** Every field, validated and normalised. The update schema is this with every field optional. */
export const themeConfigFields = {
  primaryColor: hexSchema('the main colour'),
  accentColor: hexSchema('the accent colour'),
  fontFamily: z.enum(THEME_FONT_FAMILIES, { error: 'choose theme, system, serif, rounded or mono' }),
  heroTitle: clearableLine(THEME_HERO_TITLE_MAX, 'the hero title'),
  heroSubtitle: clearableLine(THEME_HERO_SUBTITLE_MAX, 'the hero subtitle'),
  heroImage: mediaRefSchema,
  heroCtaLabel: clearableLine(THEME_HERO_CTA_LABEL_MAX, 'the button text'),
  heroCtaLink: linkSchema,
  announcementText: clearableLine(THEME_ANNOUNCEMENT_MAX, 'the announcement'),
  announcementEnabled: z.boolean({ error: 'announcementEnabled must be true or false' }),
  showFeatured: z.boolean({ error: 'showFeatured must be true or false' }),
  showCategories: z.boolean({ error: 'showCategories must be true or false' }),
  showReviews: z.boolean({ error: 'showReviews must be true or false' }),
  showBlog: z.boolean({ error: 'showBlog must be true or false' }),
} as const;

export type ThemeConfigKey = keyof typeof themeConfigFields;
export const THEME_CONFIG_KEYS = Object.keys(themeConfigFields) as ThemeConfigKey[];

/** The settings group 'themeConfig' of PATCH /api/stores/:id. Every field optional; null for the whole group resets to the defaults. Strict. */
export const storeThemeConfigUpdateSchema = z.object(themeConfigFields).partial().strict();
export type StoreThemeConfigUpdate = z.output<typeof storeThemeConfigUpdateSchema>;

// ---------------------------------------------------------------------------------------------------------- defaults

export interface ThemeConfig {
  primaryColor: string;
  accentColor: string;
  fontFamily: ThemeFontFamily;
  heroTitle: string | null;
  heroSubtitle: string | null;
  /** A media id of the store, or null. */
  heroImage: string | null;
  heroCtaLabel: string | null;
  heroCtaLink: string | null;
  announcementText: string | null;
  announcementEnabled: boolean;
  showFeatured: boolean;
  showCategories: boolean;
  showReviews: boolean;
  showBlog: boolean;
}

/** What a store that never saved a config shows: Stiletto's own colours and fonts, its own hero, every section on. */
export const THEME_CONFIG_DEFAULTS: Readonly<ThemeConfig> = Object.freeze({
  primaryColor: '#111111',
  accentColor: '#633e2b',
  fontFamily: 'theme',
  heroTitle: null,
  heroSubtitle: null,
  heroImage: null,
  heroCtaLabel: null,
  heroCtaLink: null,
  announcementText: null,
  announcementEnabled: true,
  showFeatured: true,
  showCategories: true,
  showReviews: true,
  showBlog: true,
});

/**
 * The config of a store, defaults filled in, from whatever is stored. Tolerant: a stored value that does not pass its field's rule (an old or hand-edited
 * document) falls back to the default for THAT field, so a bad value can never reach a page. Idempotent on a valid config.
 */
export function resolveThemeConfig(stored: unknown): ThemeConfig {
  const source = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...THEME_CONFIG_DEFAULTS };
  for (const key of THEME_CONFIG_KEYS) {
    if (!(key in source) || source[key] === undefined) continue;
    const parsed = themeConfigFields[key].safeParse(source[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as unknown as ThemeConfig;
}

/** True when a config equals the defaults (nothing for the theme to change). */
export function isDefaultThemeConfig(config: ThemeConfig): boolean {
  return THEME_CONFIG_KEYS.every((key) => config[key] === THEME_CONFIG_DEFAULTS[key]);
}

// ---------------------------------------------------------------------------------------------------------- the public record

/** What the storefront reads: the same config, with the hero image as a URL (the media id never leaves the seller side). */
/** A stored or received text must still be plain (no < or >, within its limit); a link must still pass normalizeThemeLink. The storefront validates AGAIN. */
const publicText = (max: number) => z.string().max(max).refine((value) => !NO_HTML.test(value), 'no markup').nullable();
const publicLink = z.string().max(THEME_HERO_CTA_LINK_MAX).refine((value) => normalizeThemeLink(value) === value, 'not a safe link').nullable();

export const storefrontThemeConfigSchema = z.object({
  primaryColor: z.string().regex(NORMAL_HEX),
  accentColor: z.string().regex(NORMAL_HEX),
  fontFamily: z.enum(THEME_FONT_FAMILIES),
  heroTitle: publicText(THEME_HERO_TITLE_MAX),
  heroSubtitle: publicText(THEME_HERO_SUBTITLE_MAX),
  heroImageUrl: z.string().nullable(),
  heroCtaLabel: publicText(THEME_HERO_CTA_LABEL_MAX),
  heroCtaLink: publicLink,
  announcementText: publicText(THEME_ANNOUNCEMENT_MAX),
  announcementEnabled: z.boolean(),
  showFeatured: z.boolean(),
  showCategories: z.boolean(),
  showReviews: z.boolean(),
  showBlog: z.boolean(),
});
export type StorefrontThemeConfig = z.output<typeof storefrontThemeConfigSchema>;

/** The public config of a config, given the URL of its hero image (null when there is none or it cannot be read). */
export function toStorefrontThemeConfig(config: ThemeConfig, heroImageUrl: string | null): StorefrontThemeConfig {
  const { heroImage: _heroImage, ...rest } = config;
  return { ...rest, heroImageUrl };
}

/** The defaults as the public record carries them (a store with no config, a theme demo, an older backend). */
export const STOREFRONT_THEME_CONFIG_DEFAULTS: Readonly<StorefrontThemeConfig> = Object.freeze(toStorefrontThemeConfig(THEME_CONFIG_DEFAULTS, null));

// ---------------------------------------------------------------------------------------------------------- the style

/**
 * The CSS custom properties of a config. Built ONLY from validated values: a colour is used only when it is exactly a normalised hex (#rrggbb), the
 * font only by its NAME through the fixed stacks above. Anything else is left out (the theme's own value stays), so no seller input can ever become a
 * CSS string. The result is a plain object for a React `style` prop; nothing is concatenated into a style attribute.
 *
 * primaryColor -> --brand-primary (the ink and buttons), accentColor -> the promo and cart-badge accents, fontFamily -> the theme's two font variables.
 */
export function themeStyleVars(config: { primaryColor?: unknown; accentColor?: unknown; fontFamily?: unknown }): Record<string, string> {
  const vars: Record<string, string> = {};
  if (isNormalizedHex(config.primaryColor)) vars['--brand-primary'] = config.primaryColor;
  if (isNormalizedHex(config.accentColor)) {
    vars['--promo-banner-button-bg'] = config.accentColor;
    vars['--nav-cart-badge-bg'] = config.accentColor;
  }
  const font = typeof config.fontFamily === 'string' && Object.prototype.hasOwnProperty.call(THEME_FONT_STACKS, config.fontFamily) ? THEME_FONT_STACKS[config.fontFamily as keyof typeof THEME_FONT_STACKS] : null;
  if (font !== null) {
    vars['--custom-sans'] = font;
    vars['--custom-heading'] = font;
  }
  return vars;
}
