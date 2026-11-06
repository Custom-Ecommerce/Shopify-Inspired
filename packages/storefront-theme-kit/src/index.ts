export const THEME_CONTRACT_VERSION = 1 as const;

export interface ThemeManifest {
  slug: string;
  version: string;
  contractVersion: typeof THEME_CONTRACT_VERSION;
}

export function defineThemeManifest<T extends ThemeManifest>(manifest: T): T {
  return manifest;
}

export type { ThemeModule, StoreLayoutProps, ThemeDemo } from "./contract";
export { defineTheme } from "./define-theme";
/* @theme-integration-patch:kit-index */
