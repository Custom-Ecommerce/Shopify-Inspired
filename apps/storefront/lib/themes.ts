import "server-only";

import { notFound } from "next/navigation";
import type { ThemeModule } from "@markaz/storefront-theme-kit";
import { DEFAULT_THEME_SLUG, getThemeEntry, resolveRenderTheme } from "@markaz/platform-kit/themes";
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
  /** The theme the store chose but cannot render (mola, gani, mustafa, unknown ...), so a notice can say it is not available yet. */
  unavailableTheme: string | null;
}

/**
 * What a store actually renders with (Sprint 7, D-115): its chosen theme if it is available, visible to sellers and bundled here,
 * otherwise the fallback, Stiletto. The rule lives in the platform manifest (resolveRenderTheme, tested there); this file only
 * says which packages are bundled.
 */
export function resolveEffectiveTheme(activeTheme: string | null | undefined): EffectiveTheme {
  return resolveRenderTheme(activeTheme, isInstalledTheme);
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
