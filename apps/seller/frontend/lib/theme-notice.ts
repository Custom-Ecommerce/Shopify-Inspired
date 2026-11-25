/**
 * Sprint 7 (D-115): the sentence the Theme tab shows when the store chose a theme that is not available (mola, gani, mustafa ...) and so is shown with
 * Stiletto. Null when there is nothing to say (the store never chose a theme, or its theme works).
 */
export function unavailableThemeNotice(unavailableTheme: string | null | undefined, themeName: string): string | null {
  if (!unavailableTheme) return null;
  const label = unavailableTheme.charAt(0).toUpperCase() + unavailableTheme.slice(1);
  return `The ${label} theme is not available yet, so your store is shown with ${themeName}. Choose ${themeName} and save to keep it.`;
}
