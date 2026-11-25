import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_ALLOWLIST, SYNC_GROUP_ALLOWLISTS, filterToAllowlist } from "./sync-schemas";

test("the settings allowlist carries the COD commission percent and the plan settings (D-116, D-118)", () => {
  for (const field of ["codCommissionPercent", "paymentInstructions", "graceDays", "trialDays", "supportEmail", "supportPhone"]) {
    assert.ok((SETTINGS_ALLOWLIST as readonly string[]).includes(field), field);
  }
  assert.equal(SYNC_GROUP_ALLOWLISTS.settings, SETTINGS_ALLOWLIST);
});

test("the settings allowlist keeps the three original settings", () => {
  for (const field of ["defaultCommissionRate", "maxStoresPerSeller", "storeApprovalRequired"]) {
    assert.ok((SETTINGS_ALLOWLIST as readonly string[]).includes(field), field);
  }
});

test("the settings allowlist never lets the revision or the note cross", () => {
  const result = filterToAllowlist({ codCommissionPercent: 2, graceDays: 7, settingsRevision: 9, stripeCommissionNote: "x" }, SETTINGS_ALLOWLIST);
  assert.deepEqual(result.data, { codCommissionPercent: 2, graceDays: 7 });
  assert.deepEqual([...result.strays].sort(), ["settingsRevision", "stripeCommissionNote"]);
});

test("S8-B5: the referral settings are sent to the seller", () => {
  for (const field of ["referralRewardMonths", "referralMonthlyCap"]) assert.ok((SETTINGS_ALLOWLIST as readonly string[]).includes(field), field);
});
