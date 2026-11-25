import {
  STOREFRONT_THEME_CONFIG_DEFAULTS,
  THEME_FONT_STACKS,
  storefrontThemeConfigSchema,
  themeStyleVars,
  type StorefrontThemeConfig,
} from "@markaz/contracts/theme-config";

/**
 * Sprint 7 (S7-B7): what a theme gets of a store's theme config. The rules (the schema, the defaults, the font stacks and the style builder) live in
 * @markaz/contracts so the seller's editor and the storefront share them; this file hands them to the themes through the one package they already use.
 */
export { STOREFRONT_THEME_CONFIG_DEFAULTS, THEME_FONT_STACKS, themeStyleVars };
export type { StorefrontThemeConfig };

/**
 * The theme config of a store view-model, validated AGAIN and defaulted: a store without one (a theme demo, an older backend) or whose config does not pass the
 * schema gets the defaults, so a page never renders a value the schema would refuse. Returns the defaults object itself (frozen) when there is nothing to apply.
 */
export function storefrontThemeConfigOf(store: { themeConfig?: unknown } | null | undefined): StorefrontThemeConfig {
  const parsed = storefrontThemeConfigSchema.safeParse(store?.themeConfig);
  return parsed.success ? parsed.data : (STOREFRONT_THEME_CONFIG_DEFAULTS as StorefrontThemeConfig);
}
