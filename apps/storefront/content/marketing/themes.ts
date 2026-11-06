import { listGalleryThemes } from "@markaz/platform-kit/themes";

export interface ThemeScreenshot {
  /** Public path, for example /themes/<slug>-desktop.webp (about 1280x800). */
  desktop: string;
  /** Public path, for example /themes/<slug>-mobile.webp (about 390x844). Optional. */
  mobile?: string;
}

/**
 * Real theme screenshots, keyed by theme slug. Explicit and build-safe: nothing reads
 * the file system at render time.
 * TODO(assets): when the files exist in public/themes/, add an entry here, for example
 * perfecto: { desktop: "/themes/perfecto-desktop.webp", mobile: "/themes/perfecto-mobile.webp" }.
 * Until then each theme shows the flat device mockup.
 */
const SCREENSHOTS: Record<string, ThemeScreenshot> = {};

export interface ThemeItem {
  id: string;
  name: string;
  description: string;
  tier: "free" | "premium";
  screenshot: ThemeScreenshot | null;
}

/** Builds the marketing view of one manifest entry. Copy is limited to what the manifest states. */
export function toThemeItem(entry: { slug: string; label: string; tier: string }): ThemeItem {
  const tier = entry.tier === "free" ? "free" : "premium";
  return {
    id: entry.slug,
    name: entry.label,
    description: tier === "free" ? "Free default theme for every store." : "Premium theme.",
    tier,
    screenshot: SCREENSHOTS[entry.slug] ?? null,
  };
}

/** Gallery entries for the home showcase and /themes. Derived from the platform manifest. */
export const THEMES: ThemeItem[] = listGalleryThemes().map(toThemeItem);
