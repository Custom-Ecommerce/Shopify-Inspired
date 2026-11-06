import { test } from "node:test";
import assert from "node:assert/strict";
import { adminSettingsUpdateRequestSchema } from "../lib/contracts";
import {
  changedSettingFields,
  formFromSettings,
  issuesToErrors,
  parseRate,
  parseStoreLimit,
  toUpdateRequest,
  validateSettingsForm,
} from "../lib/settings";

const NOW = "2026-10-11T10:00:00.000Z";
const settings = { defaultCommissionRate: 4, maxStoresPerSeller: 3, stripeCommissionNote: null, settingsRevision: 2, updatedAt: NOW };
const withNote = { ...settings, stripeCommissionNote: "Stripe takes its own fee." };

test("the form starts from the settings, with a blank note for none and no reason", () => {
  assert.deepEqual(formFromSettings(settings), { defaultCommissionRate: "4", maxStoresPerSeller: "3", stripeCommissionNote: "", reason: "" });
  assert.deepEqual(formFromSettings({ ...withNote, defaultCommissionRate: 7.5 }), {
    defaultCommissionRate: "7.5",
    maxStoresPerSeller: "3",
    stripeCommissionNote: "Stripe takes its own fee.",
    reason: "",
  });
});

test("a rate is a number from 0 to 100 and nothing else", () => {
  for (const good of ["0", "4", " 7.5 ", "100", "99.99", "0.25"]) assert.notEqual(parseRate(good), null, good);
  for (const bad of ["", "-1", "100.5", "101", "abc", "1e2", "4%", "4,5", "1000", ".5", "5."]) assert.equal(parseRate(bad), null, bad);
  assert.equal(parseRate(" 7.5 "), 7.5);
});

test("a store limit is a whole number from 1 to 1000", () => {
  for (const good of ["1", "3", " 10 ", "1000"]) assert.notEqual(parseStoreLimit(good), null, good);
  for (const bad of ["", "0", "1001", "2.5", "-3", "ten", "1e2", "10000"]) assert.equal(parseStoreLimit(bad), null, bad);
});

test("a valid form has no errors", () => {
  assert.deepEqual(validateSettingsForm({ ...formFromSettings(settings), defaultCommissionRate: "5", reason: "Q4 pricing" }), {});
});

test("the form refuses a bad rate, store limit, note, and reason with the backend's rules", () => {
  const base = { ...formFromSettings(settings), reason: "Q4 pricing" };
  assert.equal(validateSettingsForm({ ...base, defaultCommissionRate: "" }).defaultCommissionRate, "Enter a commission rate.");
  assert.equal(validateSettingsForm({ ...base, defaultCommissionRate: "101" }).defaultCommissionRate, "Enter a percentage from 0 to 100.");
  assert.equal(validateSettingsForm({ ...base, maxStoresPerSeller: "" }).maxStoresPerSeller, "Enter a store limit.");
  assert.equal(validateSettingsForm({ ...base, maxStoresPerSeller: "0" }).maxStoresPerSeller, "Enter a whole number from 1 to 1000.");
  assert.equal(validateSettingsForm({ ...base, stripeCommissionNote: "x".repeat(501) }).stripeCommissionNote, "The note can be at most 500 characters.");
  assert.equal(validateSettingsForm({ ...base, stripeCommissionNote: "x".repeat(500) }).stripeCommissionNote, undefined);
  assert.equal(validateSettingsForm({ ...base, reason: "   " }).reason, "Enter a reason for the change.");
  assert.equal(validateSettingsForm({ ...base, reason: "x".repeat(501) }).reason, "The reason can be at most 500 characters.");
});

test("only a value that differs counts as a change; the same number written differently does not", () => {
  const base = formFromSettings(settings);
  assert.deepEqual(changedSettingFields(base, settings), []);
  assert.deepEqual(changedSettingFields({ ...base, defaultCommissionRate: "4.0" }, settings), []);
  assert.deepEqual(changedSettingFields({ ...base, maxStoresPerSeller: " 3 " }, settings), []);
  assert.deepEqual(changedSettingFields({ ...base, stripeCommissionNote: "   " }, settings), []);
  assert.deepEqual(changedSettingFields({ ...base, defaultCommissionRate: "5" }, settings), ["defaultCommissionRate"]);
  assert.deepEqual(changedSettingFields({ ...base, stripeCommissionNote: "Fees by Stripe" }, settings), ["stripeCommissionNote"]);
  assert.deepEqual(changedSettingFields({ ...base, defaultCommissionRate: "5", maxStoresPerSeller: "4", stripeCommissionNote: "x" }, settings), [
    "defaultCommissionRate",
    "maxStoresPerSeller",
    "stripeCommissionNote",
  ]);
});

test("a typed reason alone is not a change, and an unreadable value is a change so validation can report it", () => {
  const base = formFromSettings(settings);
  assert.deepEqual(changedSettingFields({ ...base, reason: "because" }, settings), []);
  assert.deepEqual(changedSettingFields({ ...base, defaultCommissionRate: "abc" }, settings), ["defaultCommissionRate"]);
  assert.deepEqual(changedSettingFields({ ...base, maxStoresPerSeller: "" }, settings), ["maxStoresPerSeller"]);
});

test("the update sends only what changed, with the trimmed reason, and passes the contract", () => {
  const values = { ...formFromSettings(settings), defaultCommissionRate: " 5 ", reason: "  Q4 pricing  " };
  const request = toUpdateRequest(values, settings);
  assert.deepEqual(request, { defaultCommissionRate: 5, reason: "Q4 pricing" });
  assert.equal(adminSettingsUpdateRequestSchema.safeParse(request).success, true);
  const all = toUpdateRequest({ defaultCommissionRate: "2.5", maxStoresPerSeller: "10", stripeCommissionNote: "  Fees  ", reason: "Reset" }, settings);
  assert.deepEqual(all, { defaultCommissionRate: 2.5, maxStoresPerSeller: 10, stripeCommissionNote: "Fees", reason: "Reset" });
  assert.equal(adminSettingsUpdateRequestSchema.safeParse(all).success, true);
});

test("a blank note clears a stored note with null, and leaves a missing note out", () => {
  const cleared = toUpdateRequest({ ...formFromSettings(withNote), stripeCommissionNote: "  ", reason: "Not needed" }, withNote);
  assert.deepEqual(cleared, { stripeCommissionNote: null, reason: "Not needed" });
  assert.equal(adminSettingsUpdateRequestSchema.safeParse(cleared).success, true);
  const untouched = toUpdateRequest({ ...formFromSettings(settings), maxStoresPerSeller: "4", reason: "Bigger sellers" }, settings);
  assert.equal("stripeCommissionNote" in untouched, false);
});

test("the update never carries a revision or an update time", () => {
  const request = toUpdateRequest({ ...formFromSettings(settings), maxStoresPerSeller: "5", reason: "Growth" }, settings) as Record<string, unknown>;
  assert.equal("settingsRevision" in request, false);
  assert.equal("updatedAt" in request, false);
});

test("the backend's issues land on the matching fields, capitalised, and other issues are dropped", () => {
  const errors = issuesToErrors([
    { path: "defaultCommissionRate", message: "must be a number from 0 to 100" },
    { path: "reason", message: "Enter a reason." },
    { path: "body", message: "change at least one setting" },
    { path: "settingsRevision", message: "is not a platform setting" },
  ]);
  assert.deepEqual(errors, { defaultCommissionRate: "Must be a number from 0 to 100.", reason: "Enter a reason." });
});
