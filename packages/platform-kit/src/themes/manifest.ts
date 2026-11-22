/**
 * Theme manifest — the single source of truth for which theme slugs exist
 * (report §3.6, decision P1-D5).
 *
 * Consumers:
 *   - Admin and Seller `Stores.activeTheme` select options and default
 *     (via the re-exports in each backend's src/lib/themes.ts).
 *   - The reserved-label registry (every slug here is reserved, see
 *     `../reservation`).
 *   - The storefront host classifier and `/themes` gallery (M4/M6).
 *
 * Adding a theme is a data change in this file. The reservation invariants
 * (`listReservationViolations`) fail if a slug is added that collides with a
 * reserved word or breaks slug format.
 *
 * Pure and Payload-agnostic: no I/O, no environment reads.
 */

export const THEME_TIERS = ["free", "paid", "unassigned"] as const;
export type ThemeTier = (typeof THEME_TIERS)[number];

/**
 * - `available`    selectable by sellers and listed in the gallery.
 * - `coming_soon`  listed in the gallery as "Coming soon", with no purchase
 *                  path (P1-D13). Selectable in the Admin for demo seeding.
 * - `archived`     kept so existing stores keep rendering and their slugs stay
 *                  reserved. Not listed in the gallery.
 */
export const THEME_STATUSES = ["available", "coming_soon", "archived"] as const;
export type ThemeStatus = (typeof THEME_STATUSES)[number];

export interface ThemeManifestEntry {
  readonly slug: string;
  readonly label: string;
  readonly tier: ThemeTier;
  readonly status: ThemeStatus;
  /** The theme new stores start with. Exactly one entry must set this. */
  readonly isDefault: boolean;
  readonly note?: string;
  /** Sprint 4 EP-04.US04: a theme package exists, so a store may choose it (apps/storefront/lib/themes.ts loads it). */
  readonly installed?: boolean;
  /** Public path of a preview image, when there is one. */
  readonly previewImage?: string;
  /**
   * Sprint 7 (D-115): the theme package stays in the repository but sellers cannot choose it and the public gallery does not list it. A store that
   * still has it as its activeTheme renders the fallback theme instead.
   */
  readonly hiddenFromSellers?: boolean;
  /**
   * SB-11 (V-06): the theme's checkout can take a card payment (choose card, then go to the payment page). A theme without
   * this flag is treated as NOT supporting it, so a store whose only payment method is card cannot use it.
   */
  readonly supportsCardCheckout?: boolean;
}

export const THEME_MANIFEST = [
  {
    slug: "mustafa",
    label: "Mustafa",
    tier: "free",
    status: "available",
    isDefault: false,
    installed: true,
    hiddenFromSellers: true,
    note: "Sprint 7 (D-115): kept in the repository, hidden from sellers. A store that still has it renders Stiletto.",
  },
  {
    slug: "stiletto",
    label: "Stiletto",
    tier: "free",
    status: "available",
    isDefault: true,
    installed: true,
    supportsCardCheckout: true,
    previewImage: "/theme-previews/stiletto.svg",
  },
  {
    slug: "mola",
    label: "Mola",
    tier: "paid",
    status: "coming_soon",
    isDefault: false,
    note: "Sprint 7 (D-115): not finished. The slug stays reserved.",
  },
  {
    slug: "gani",
    label: "Gani",
    tier: "paid",
    status: "coming_soon",
    isDefault: false,
    note: "Sprint 7 (D-115): not finished. The slug stays reserved.",
  },
  {
    slug: "farooq",
    label: "Farooq",
    tier: "unassigned",
    status: "coming_soon",
    isDefault: false,
    note: "Named in the Phase 4 roadmap only. Tier pending P1-D5.",
  },
  {
    slug: "perfecto",
    label: "Perfecto",
    tier: "unassigned",
    status: "archived",
    isDefault: false,
    note: "Legacy theme. Existing stores keep it. Tailwind v3 preset, not used by the v4 storefront (P1-D10).",
  },
  {
    slug: "minimal",
    label: "Minimal",
    tier: "unassigned",
    status: "archived",
    isDefault: false,
    note: "Legacy theme. Existing stores keep it.",
  },
] as const satisfies readonly ThemeManifestEntry[];

/** Every theme slug the platform knows about, including archived ones. */
export type ThemeSlug = (typeof THEME_MANIFEST)[number]["slug"];

export const THEME_SLUGS: readonly ThemeSlug[] = THEME_MANIFEST.map((entry) => entry.slug);

/**
 * The fallback theme: what a store renders with when it has no theme set, or its theme is unknown, archived, coming soon,
 * hidden from sellers or not installed. Sprint 7 (D-115, D-118): Stiletto, the only finished theme. Must be an `available`,
 * installed entry that sellers can choose (checked by the manifest test).
 */
export const DEFAULT_THEME_SLUG: ThemeSlug = "stiletto";

/**
 * The theme a NEW store is created with (D-059): written to `storefront.activeTheme` when the store is provisioned. All
 * EP-01 theme work (variant selector, gallery video, favourites, preview banner) is in Stiletto, and Mustafa shows a
 * multi-variant product as sold out. Must be an `available` entry with an installed package.
 */
export const NEW_STORE_THEME_SLUG: ThemeSlug = "stiletto";

const THEME_SLUG_SET: ReadonlySet<string> = new Set<string>(THEME_SLUGS);

export function isThemeSlug(value: unknown): value is ThemeSlug {
  return typeof value === "string" && THEME_SLUG_SET.has(value);
}

export function getThemeEntry(slug: string): ThemeManifestEntry | undefined {
  return THEME_MANIFEST.find((entry) => entry.slug === slug);
}

/**
 * Sprint 4 EP-04.US04: the themes a store can choose: installed (a package exists) and not archived. The storefront's
 * loader map (apps/storefront/lib/themes.ts) must have an entry for each; the manifest test checks the flag is set only
 * where a package exists.
 */
export function listInstalledThemes(): readonly ThemeManifestEntry[] {
  return THEME_MANIFEST.filter((entry) => (entry as ThemeManifestEntry).installed === true && entry.status !== "archived");
}

export function isInstalledThemeSlug(value: unknown): boolean {
  return typeof value === "string" && listInstalledThemes().some((entry) => entry.slug === value);
}

/**
 * SB-11 (V-06): whether a theme's checkout can take a card payment. Stiletto yes; Mustafa has no payment choice, so no.
 * Default false for a theme without the flag, and for an unknown slug.
 */
export function themeSupportsCardCheckout(slug: unknown): boolean {
  return typeof slug === "string" && getThemeEntry(slug)?.supportsCardCheckout === true;
}

/**
 * Sprint 7 (D-115): the themes a seller can choose: installed, `available` and not hidden from sellers. Today that is Stiletto only.
 * GET /api/themes and the settings writer both use this one list.
 */
export function listSellerThemes(): readonly ThemeManifestEntry[] {
  return THEME_MANIFEST.filter(
    (entry) => (entry as ThemeManifestEntry).installed === true && entry.status === "available" && (entry as ThemeManifestEntry).hiddenFromSellers !== true,
  );
}

export function isSellerThemeSlug(value: unknown): boolean {
  return typeof value === "string" && listSellerThemes().some((entry) => entry.slug === value);
}

/**
 * Sprint 7 (S7-B7, D-118): a PREMIUM theme is one on the paid tier. Choosing it needs a plan with limits.premiumThemes (Growth). Stiletto is free. Today no
 * installed theme is premium (mola and gani are paid but coming soon), so the rule is built and tested against a fake entry. `entries` defaults to the manifest.
 */
export function isPremiumTheme(slug: unknown, entries: readonly Pick<ThemeManifestEntry, "slug" | "tier">[] = THEME_MANIFEST): boolean {
  return typeof slug === "string" && entries.some((entry) => entry.slug === slug && entry.tier === "paid");
}

/**
 * The plan gate for a theme: allowed unless the theme is premium and the plan has no premium themes. `locked` is what the theme list reports.
 */
export function themePlanGate(
  slug: unknown,
  premiumThemesAllowed: boolean,
  entries: readonly Pick<ThemeManifestEntry, "slug" | "tier">[] = THEME_MANIFEST,
): { premium: boolean; locked: boolean } {
  const premium = isPremiumTheme(slug, entries);
  return { premium, locked: premium && !premiumThemesAllowed };
}

/**
 * Entries shown in the public `/themes` gallery: every theme that is not archived and not hidden. A theme that is not finished is
 * listed with status `coming_soon` and nothing else (no demo, no purchase path).
 */
export function listGalleryThemes(): readonly ThemeManifestEntry[] {
  return THEME_MANIFEST.filter((entry) => entry.status !== "archived" && (entry as ThemeManifestEntry).hiddenFromSellers !== true);
}

export interface RenderTheme {
  /** The slug the storefront renders with. */
  slug: string;
  source: "store" | "default";
  fallbackReason?: string;
  /**
   * The slug the store chose but cannot render (hidden, coming soon, archived, unknown or not installed), so the dashboard can say
   * "this theme is not available yet". Null when there is no problem, or when the store never chose a theme.
   */
  unavailableTheme: string | null;
}

/**
 * Sprint 7 (D-115, D-118): the one place that decides what a store renders with. A store whose activeTheme is mola, gani or mustafa (or
 * anything unknown) renders DEFAULT_THEME_SLUG (Stiletto). `isLoadable` is the caller's loader map (the storefront knows which packages
 * are bundled); it defaults to the manifest's `installed` flag.
 */
export function resolveRenderTheme(
  activeTheme: string | null | undefined,
  isLoadable: (slug: string) => boolean = (slug) => isInstalledThemeSlug(slug),
): RenderTheme {
  if (!activeTheme) return { slug: DEFAULT_THEME_SLUG, source: "default", fallbackReason: "no theme chosen", unavailableTheme: null };
  const fallback = (reason: string): RenderTheme => ({ slug: DEFAULT_THEME_SLUG, source: "default", fallbackReason: reason + ": " + activeTheme, unavailableTheme: activeTheme });
  const entry = getThemeEntry(activeTheme);
  if (!entry) return fallback("unknown theme");
  if (entry.status === "archived") return fallback("theme archived");
  if (entry.status === "coming_soon") return fallback("theme not available yet");
  if ((entry as ThemeManifestEntry).hiddenFromSellers === true) return fallback("theme not available yet");
  if (!isLoadable(activeTheme)) return fallback("theme package not installed");
  return { slug: activeTheme, source: "store", unavailableTheme: null };
}

function themeOptionLabel(entry: ThemeManifestEntry): string {
  if (entry.status === "archived") return `${entry.label} (archived)`;
  if (entry.status === "coming_soon") return `${entry.label} (coming soon)`;
  return entry.label;
}

/**
 * Payload `select` options for `activeTheme`. Archived themes stay in the list
 * so an existing store that holds one still validates on save.
 */
export const THEME_OPTIONS: { label: string; value: ThemeSlug }[] = THEME_MANIFEST.map((entry) => ({
  label: themeOptionLabel(entry),
  value: entry.slug,
}));
/* @theme-integration-patch:manifest */
