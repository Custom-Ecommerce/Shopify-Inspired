import "server-only";

import { notFound } from "next/navigation";
import type { ThemeModule } from "@markaz/storefront-theme-kit";
import { DEFAULT_THEME_SLUG, getThemeEntry } from "@markaz/platform-kit/themes";
import { resolveStore } from "@/lib/tenancy/resolve-store";

type Loader = () => Promise<{ default: ThemeModule }>;

/** Themes that have a package on disk. A slug in the platform manifest without an entry here falls back to the default. */
const LOADERS: Record<string, Loader> = {
  mustafa: () => import("@markaz/theme-mustafa"),
  stiletto: () => import("@markaz/theme-stiletto"),
};

export function isInstalledTheme(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOADERS, slug);
}

/** The theme module for a slug. Unknown or not-installed slugs get the default theme. */
export async function getTheme(slug: string): Promise<ThemeModule> {
  const loader = isInstalledTheme(slug) ? LOADERS[slug] : LOADERS[DEFAULT_THEME_SLUG];
  return (await loader()).default;
}

export interface EffectiveTheme {
  slug: string;
  source: "store" | "default";
  fallbackReason?: string;
}

/** What a store actually renders with: its chosen theme if it is available and installed, otherwise the default. */
export function resolveEffectiveTheme(activeTheme: string | null | undefined): EffectiveTheme {
  if (!activeTheme) return { slug: DEFAULT_THEME_SLUG, source: "default", fallbackReason: "no theme chosen" };
  const entry = getThemeEntry(activeTheme);
  if (!entry) return { slug: DEFAULT_THEME_SLUG, source: "default", fallbackReason: "unknown theme " + activeTheme };
  if (entry.status === "archived") return { slug: DEFAULT_THEME_SLUG, source: "default", fallbackReason: "theme archived: " + activeTheme };
  if (!isInstalledTheme(activeTheme)) return { slug: DEFAULT_THEME_SLUG, source: "default", fallbackReason: "theme package not installed: " + activeTheme };
  return { slug: activeTheme, source: "store" };
}

/** The theme for a live store, read from the store the tenant layout already resolved (React's per-request cache). */
export async function getTenantTheme(tenantKey: string): Promise<ThemeModule> {
  const result = await resolveStore(tenantKey, "slug");
  const slug = result.outcome === "ok" ? resolveEffectiveTheme(result.store.theme.activeTheme).slug : DEFAULT_THEME_SLUG;
  return getTheme(slug);
}

/** The theme for a demo host. Only available, installed themes have a demo; anything else is a 404. */
export async function requireDemoTheme(themeSlug: string): Promise<ThemeModule> {
  const entry = getThemeEntry(themeSlug);
  if (!entry || entry.status !== "available" || !isInstalledTheme(themeSlug)) notFound();
  return getTheme(themeSlug);
}
