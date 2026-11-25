import * as themesNs from '@markaz/platform-kit/themes';
import { unwrapCjs } from '@/lib/cjs';
import { PlanLimitError } from '@/lib/http';
import { loadEffectivePlan, canCheckPlans } from '@/lib/plan';

const themes: typeof themesNs = unwrapCjs(themesNs);

/**
 * Sprint 7 (S7-B7, D-118): the plan gate of a theme. A premium theme (paid tier) needs a plan with limits.premiumThemes (Growth); Stiletto is free. No installed
 * theme is premium today, so the gate is exercised with a fake manifest in the tests (`entries`).
 */

type Entries = readonly Pick<themesNs.ThemeManifestEntry, 'slug' | 'tier'>[];

/**
 * Refuses a premium theme on a plan without premium themes: 403 PLAN_LIMIT_REACHED, limitKind premiumThemes (the same family as the other plan gates).
 * It runs after the ownership checks, like assertWithinPlan, and only when the theme is CHANGED (a store that already has one keeps it). Where plans cannot
 * be checked (a unit test with no connection) it does nothing.
 */
export async function assertThemeAllowedByPlan(ownerId: string, slug: string, entries?: Entries, now: Date = new Date()): Promise<void> {
  if (!themes.isPremiumTheme(slug, entries)) return;
  if (!canCheckPlans()) return;
  const plan = await loadEffectivePlan(ownerId, now);
  if (!themes.themePlanGate(slug, plan.limits.premiumThemes === true, entries).locked) return;
  const upgradeHint = 'Premium themes are part of the Growth plan. Upgrade to use this theme.';
  throw new PlanLimitError(
    { code: 'PLAN_LIMIT_REACHED', limitKind: 'premiumThemes', limit: 0, used: 0, plan: plan.key, upgradeHint },
    'Your ' + plan.name + ' plan does not include premium themes. ' + upgradeHint,
  );
}

/** For GET /api/themes: whether each listed theme is premium, and whether it is locked for this seller's plan. */
export function themeLockFlags(slug: string, premiumThemesAllowed: boolean, entries?: Entries): { premium: boolean; locked: boolean } {
  return themes.themePlanGate(slug, premiumThemesAllowed, entries);
}
