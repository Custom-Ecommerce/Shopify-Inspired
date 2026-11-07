import { unwrapCjs } from '@/lib/cjs';
import * as themesNs from '@markaz/platform-kit/themes';

// The package is CommonJS: read it through the default object, as services.ts does, so Next and the test runner agree.
const themes: typeof themesNs = unwrapCjs(themesNs);

/**
 * The storefront settings a store is created with. Only the theme so far (D-059: Stiletto); everything else stays unset
 * until the seller saves Store Settings. Existing stores are never touched by this.
 */
export function newStoreStorefront(): { activeTheme: string } {
  return { activeTheme: themes.NEW_STORE_THEME_SLUG };
}
