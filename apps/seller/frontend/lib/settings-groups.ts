/**
 * The groups of PATCH /api/stores/:id that the seller portal may forward (Sprint 4 EP-04, Sprint 5 EP-11 and EP-13, Sprint 8 tax). The list is the keys of
 * the contracts storeSettingsUpdateSchema: test/settings-groups.test.ts fails when a group is added there and not here (SB-6, verification
 * bug 4: fraud and returns were missing, so the Fraud and Returns tabs could not save). The backend checks every field of every group again.
 */
export const SETTINGS_GROUPS: readonly string[] = ["profile", "branding", "social", "seo", "delivery", "payments", "payout", "theme", "messages", "fraud", "returns", "domain", "themeConfig", "tax"];
