import type { ThemeModule } from "./contract";

/** Identity helper that type-checks a theme against the contract (Appendix A: defineTheme). */
export function defineTheme(theme: ThemeModule): ThemeModule {
  return theme;
}
