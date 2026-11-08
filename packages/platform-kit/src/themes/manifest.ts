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
}

export const THEME_MANIFEST = [
  {
    slug: "mustafa",
    label: "Mustafa",
    tier: "free",
    status: "available",
    isDefault: true,
  },
  {
    slug: "stiletto",
    label: "Stiletto",
    tier: "free",
    status: "available",
    isDefault: false,
  },
  {
    slug: "mola",
    label: "Mola",
    tier: "paid",
    status: "available",
    isDefault: false,
    note: "Pricing TBD (P1-D2 / Phase 6).",
  },
  {
    slug: "gani",
    label: "Gani",
    tier: "paid",
    status: "available",
    isDefault: false,
    note: "Pricing TBD (P1-D2 / Phase 6).",
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
 * The fallback theme: what a store renders with when it has no theme set, or its theme is unknown, archived or not
 * installed. Stores created before D-059 have no theme set and keep rendering with this, so it is not changed. Must be an
 * `available` entry (checked by invariants).
 */
export const DEFAULT_THEME_SLUG: ThemeSlug = "mustafa";

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

/** Entries shown in the public `/themes` gallery (everything except archived). */
export function listGalleryThemes(): readonly ThemeManifestEntry[] {
  return THEME_MANIFEST.filter((entry) => entry.status !== "archived");
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
