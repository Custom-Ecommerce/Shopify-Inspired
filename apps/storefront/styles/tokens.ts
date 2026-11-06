/* @markaz/storefront:p0-tokens
 * Token names for JS consumers. Values live in tokens.css and nowhere else.
 */
export const colorTokens = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "surface-1", "surface-2", "primary", "primary-foreground", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "text-tertiary", "accent", "accent-foreground",
  "border", "border-strong", "input", "ring",
] as const;

export const statusTokens = ["destructive", "success", "warning", "info"] as const;
export const chartTokens = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export const radiusTokens = { sm: "6px", md: "8px", lg: "0.75rem" } as const;

export type ColorToken = (typeof colorTokens)[number];
export type StatusToken = (typeof statusTokens)[number];

/** CSS variable reference for a token, for inline styles and chart props. */
export const cssVar = (name: string) => `var(--${name})`;
