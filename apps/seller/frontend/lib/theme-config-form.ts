import {
  THEME_ANNOUNCEMENT_MAX,
  THEME_CONFIG_DEFAULTS,
  THEME_FONT_FAMILIES,
  THEME_HERO_CTA_LABEL_MAX,
  THEME_HERO_SUBTITLE_MAX,
  THEME_HERO_TITLE_MAX,
  normalizeHexColor,
  normalizeThemeLink,
  themeStyleVars,
  type ThemeFontFamily,
} from "@markaz/contracts/theme-config";
import { stableText } from "./store-settings-form";

/**
 * Sprint 7 (S7-B7): the Stiletto theme editor on the Theme tab. Pure: the form state, what changed, what a typed colour or link means, the small preview, and the
 * words. No React and no fetch. The server validates every field again; nothing here is trusted, and nothing here builds CSS from text: the preview takes its
 * style from the same themeStyleVars the storefront uses (a normalised hex, a font NAME).
 */

export { THEME_ANNOUNCEMENT_MAX, THEME_HERO_CTA_LABEL_MAX, THEME_HERO_SUBTITLE_MAX, THEME_HERO_TITLE_MAX, THEME_FONT_FAMILIES };

/** What the settings answer carries (GET .../settings and the PATCH answer): the config with the defaults filled in, the hero as media. */
export interface ThemeConfigRead {
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  heroTitle: string | null;
  heroSubtitle: string | null;
  heroImage: { id: string; url: string | null } | null;
  heroCtaLabel: string | null;
  heroCtaLink: string | null;
  announcementText: string | null;
  announcementEnabled: boolean;
  showFeatured: boolean;
  showCategories: boolean;
  showReviews: boolean;
  showBlog: boolean;
}

/** The editor's form: colours as what the seller typed (checked live), texts as strings (empty = none), the hero as the picked picture. */
export interface ThemeConfigForm {
  primaryColor: string;
  accentColor: string;
  fontFamily: ThemeFontFamily;
  heroTitle: string;
  heroSubtitle: string;
  heroImage: { id: string; url: string | null } | null;
  heroCtaLabel: string;
  heroCtaLink: string;
  announcementText: string;
  announcementEnabled: boolean;
  showFeatured: boolean;
  showCategories: boolean;
  showReviews: boolean;
  showBlog: boolean;
}

export const FONT_LABELS: Record<ThemeFontFamily, string> = {
  theme: "Stiletto (default)",
  system: "Clean (system)",
  serif: "Classic (serif)",
  rounded: "Friendly (rounded)",
  mono: "Typewriter (mono)",
};

const isFont = (value: unknown): value is ThemeFontFamily => typeof value === "string" && (THEME_FONT_FAMILIES as readonly string[]).includes(value);

/** The form for a settings answer. An older backend without a themeConfig gives the defaults. */
export function formFromConfig(config: ThemeConfigRead | null | undefined): ThemeConfigForm {
  const d = THEME_CONFIG_DEFAULTS;
  return {
    primaryColor: config?.primaryColor ?? d.primaryColor,
    accentColor: config?.accentColor ?? d.accentColor,
    fontFamily: isFont(config?.fontFamily) ? config!.fontFamily as ThemeFontFamily : d.fontFamily,
    heroTitle: config?.heroTitle ?? "",
    heroSubtitle: config?.heroSubtitle ?? "",
    heroImage: config?.heroImage ?? null,
    heroCtaLabel: config?.heroCtaLabel ?? "",
    heroCtaLink: config?.heroCtaLink ?? "",
    announcementText: config?.announcementText ?? "",
    announcementEnabled: config?.announcementEnabled ?? d.announcementEnabled,
    showFeatured: config?.showFeatured ?? d.showFeatured,
    showCategories: config?.showCategories ?? d.showCategories,
    showReviews: config?.showReviews ?? d.showReviews,
    showBlog: config?.showBlog ?? d.showBlog,
  };
}

/** The defaults as a form (what "Reset to defaults" shows before it is saved). */
export const defaultForm = (): ThemeConfigForm => formFromConfig(null);

/** A typed colour as it would be saved (normalised, the # optional), or the typed text when it is not a colour (the check then marks it). */
function colorOf(text: string): string {
  const typed = text.trim();
  return normalizeHexColor(typed.startsWith("#") ? typed : "#" + typed) ?? typed;
}

/** What is saved of a form, comparable: colours normalised, texts trimmed, the picture by id. */
function comparable(form: ThemeConfigForm): Record<string, unknown> {
  return {
    ...form,
    primaryColor: colorOf(form.primaryColor),
    accentColor: colorOf(form.accentColor),
    heroTitle: form.heroTitle.trim(),
    heroSubtitle: form.heroSubtitle.trim(),
    heroCtaLabel: form.heroCtaLabel.trim(),
    heroCtaLink: form.heroCtaLink.trim(),
    announcementText: form.announcementText.trim(),
    heroImage: form.heroImage?.id ?? null,
  };
}

export function isConfigDirty(saved: ThemeConfigForm, current: ThemeConfigForm): boolean {
  return stableText(comparable(saved)) !== stableText(comparable(current));
}

/** True when the form equals the defaults (the Reset button has nothing to do). */
export const isDefaultForm = (form: ThemeConfigForm): boolean => !isConfigDirty(defaultForm(), form);

/** The group body of a save: only the fields that changed, as the API takes them (an empty text clears: null; the picture is its id). Null when nothing changed. */
export function themeConfigPatch(saved: ThemeConfigForm, current: ThemeConfigForm): Record<string, unknown> | null {
  const before = comparable(saved);
  const after = comparable(current);
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (stableText(before[key]) === stableText(after[key])) continue;
    const value = after[key];
    body[key] = value === "" ? null : value;
  }
  return Object.keys(body).length === 0 ? null : body;
}

/** The body of "Reset to defaults": the whole group null, which the server stores as no config. */
export const RESET_BODY = { themeConfig: null } as const;

// ------------------------------------------------------------------------------------------------------- typed values, live

export type FieldCheck = { ok: true; normalized: string } | { ok: false; message: string };

/** A typed colour: #rgb or #rrggbb. The seller may leave out the #. */
export function checkColor(text: string): FieldCheck {
  const typed = text.trim();
  const hex = normalizeHexColor(typed.startsWith("#") ? typed : "#" + typed);
  return hex === null ? { ok: false, message: "Use a colour like #1a2b3c (3 or 6 letters and numbers after the #)." } : { ok: true, normalized: hex };
}

/** A typed link: empty is fine (the theme's own); else a page of the store (starts with /) or an https address. */
export function checkLink(text: string): FieldCheck {
  const typed = text.trim();
  if (typed === "") return { ok: true, normalized: "" };
  const link = normalizeThemeLink(typed);
  return link === null ? { ok: false, message: "Start with / for a page of your store (for example /products) or with https://." } : { ok: true, normalized: link };
}

const TAGS = /[<>]/;

/** A typed text: within its limit and without < or >. */
export function checkText(text: string, max: number, label: string): FieldCheck {
  const typed = text.trim();
  if (typed.length > max) return { ok: false, message: label + " can be at most " + max + " characters." };
  if (TAGS.test(typed)) return { ok: false, message: label + " cannot contain < or >." };
  return { ok: true, normalized: typed };
}

/** Every problem of the form, by the field the server would name (themeConfig.<field>), so Save can be held back and the fields marked before a request. */
export function formProblems(form: ThemeConfigForm): Record<string, string> {
  const problems: Record<string, string> = {};
  const note = (field: string, check: FieldCheck) => {
    if (!check.ok) problems["themeConfig." + field] = check.message;
  };
  note("primaryColor", checkColor(form.primaryColor));
  note("accentColor", checkColor(form.accentColor));
  note("heroTitle", checkText(form.heroTitle, THEME_HERO_TITLE_MAX, "The title"));
  note("heroSubtitle", checkText(form.heroSubtitle, THEME_HERO_SUBTITLE_MAX, "The subtitle"));
  note("heroCtaLabel", checkText(form.heroCtaLabel, THEME_HERO_CTA_LABEL_MAX, "The button text"));
  note("announcementText", checkText(form.announcementText, THEME_ANNOUNCEMENT_MAX, "The announcement"));
  note("heroCtaLink", checkLink(form.heroCtaLink));
  return problems;
}

// ------------------------------------------------------------------------------------------------------- the small preview

export interface PreviewModel {
  /** CSS custom properties for the preview box, built from VALIDATED values only (the same builder the storefront uses). */
  style: Record<string, string>;
  announcement: string | null;
  title: string;
  subtitle: string | null;
  button: string;
  imageUrl: string | null;
  sections: Array<{ key: "categories" | "featured" | "reviews" | "blog"; label: string; on: boolean }>;
}

/**
 * What the sandboxed preview draws: the Stiletto header and hero as plain text and a coloured box, from the form as typed. A value that does not pass its check
 * is left out (the theme's own shows), exactly as the storefront would do. No iframe and no request: this is the "preview before saving" (the config has one live
 * version, so there is no draft on the server).
 */
export function previewOf(form: ThemeConfigForm, storeName: string): PreviewModel {
  const primary = checkColor(form.primaryColor);
  const accent = checkColor(form.accentColor);
  const title = checkText(form.heroTitle, THEME_HERO_TITLE_MAX, "t");
  const subtitle = checkText(form.heroSubtitle, THEME_HERO_SUBTITLE_MAX, "s");
  const button = checkText(form.heroCtaLabel, THEME_HERO_CTA_LABEL_MAX, "b");
  const announcement = checkText(form.announcementText, THEME_ANNOUNCEMENT_MAX, "a");
  return {
    style: themeStyleVars({
      primaryColor: primary.ok ? primary.normalized : undefined,
      accentColor: accent.ok ? accent.normalized : undefined,
      fontFamily: form.fontFamily,
    }),
    announcement: form.announcementEnabled ? (announcement.ok && announcement.normalized !== "" ? announcement.normalized : "Welcome to " + storeName) : null,
    title: title.ok && title.normalized !== "" ? title.normalized : "ELEVATED EVERYDAY ESSENTIALS",
    subtitle: subtitle.ok && subtitle.normalized !== "" ? subtitle.normalized : "Premium essentials designed for fit and elegance.",
    button: button.ok && button.normalized !== "" ? button.normalized : "SHOP NOW",
    imageUrl: form.heroImage?.url ?? null,
    sections: [
      { key: "categories", label: "Shop by category", on: form.showCategories },
      { key: "featured", label: "Featured products", on: form.showFeatured },
      { key: "reviews", label: "Reviews", on: form.showReviews },
      { key: "blog", label: "Blog link in the footer", on: form.showBlog },
    ],
  };
}

/** The sentence under the Save button of the editor. */
export const SAVED_TEXT = "Look saved. Open the preview to see it on your store.";
