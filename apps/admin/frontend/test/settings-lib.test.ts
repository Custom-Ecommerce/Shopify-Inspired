import { test } from "node:test";
import assert from "node:assert/strict";
import { adminSettingsUpdateRequestSchema } from "../lib/contracts";
import {
  changedSettingFields,
  formFromSettings,
  issuesToErrors,
  parseDays,
  parseRate,
  parseStoreLimit,
  toUpdateRequest,
  validateSettingsForm,
} from "../lib/settings";

const NOW = "2026-10-11T10:00:00.000Z";
const settings = {
  defaultCommissionRate: 4,
  maxStoresPerSeller: 3,
  stripeCommissionNote: null,
  storeApprovalRequired: false,
  codCommissionPercent: 0,
  paymentInstructions: null,
  graceDays: 7,
  trialDays: 0,
  supportEmail: null,
  supportPhone: null,
  referralRewardMonths: 1,
  referralMonthlyCap: 5,
  minSellerAppVersion: null,
  minAdminAppVersion: null,
  settingsRevision: 2,
  updatedAt: NOW,
};
const withNote = { ...settings, stripeCommissionNote: "Stripe takes its own fee." };

test("the form starts from the settings, with a blank note for none and no reason", () => {
  assert.deepEqual(formFromSettings(settings), {
    defaultCommissionRate: "4",
    maxStoresPerSeller: "3",
    stripeCommissionNote: "",
    codCommissionPercent: "0",
    paymentInstructions: "",
    graceDays: "7",
    trialDays: "0",
    supportEmail: "",
    supportPhone: "",
    referralRewardMonths: "1",
    referralMonthlyCap: "5",
    minSellerAppVersion: "",
    minAdminAppVersion: "",
    reason: "",
  });
  assert.deepEqual(formFromSettings({ ...withNote, defaultCommissionRate: 7.5 }), {
    defaultCommissionRate: "7.5",
    maxStoresPerSeller: "3",
    stripeCommissionNote: "Stripe takes its own fee.",
    codCommissionPercent: "0",
    paymentInstructions: "",
    graceDays: "7",
    trialDays: "0",
    supportEmail: "",
    supportPhone: "",
    referralRewardMonths: "1",
    referralMonthlyCap: "5",
    minSellerAppVersion: "",
    minAdminAppVersion: "",
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
  assert.equal(validateSettingsForm({ ...base, reason: "x".repeat(301) }).reason, "The reason can be at most 300 characters.");
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
  const all = toUpdateRequest({ ...formFromSettings(settings), defaultCommissionRate: "2.5", maxStoresPerSeller: "10", stripeCommissionNote: "  Fees  ", reason: "Reset" }, settings);
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

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 (D-116, D-118): the COD commission percent and the plan settings in the form.

const filled = {
  ...settings,
  codCommissionPercent: 2,
  paymentInstructions: "Pay to Meezan 0123, then send the slip.",
  graceDays: 10,
  trialDays: 14,
  supportEmail: "help@example.com",
  supportPhone: "0300-1234567",
};

test("Sprint 6: the form shows every new setting as text, blank for a missing text", () => {
  const form = formFromSettings(filled);
  assert.equal(form.codCommissionPercent, "2");
  assert.equal(form.paymentInstructions, "Pay to Meezan 0123, then send the slip.");
  assert.equal(form.graceDays, "10");
  assert.equal(form.trialDays, "14");
  assert.equal(form.supportEmail, "help@example.com");
  assert.equal(form.supportPhone, "0300-1234567");
});

test("Sprint 6: days are whole numbers inside their range and nothing else", () => {
  for (const good of ["0", "7", " 30 "]) assert.notEqual(parseDays(good, 0, 30), null, good);
  for (const bad of ["", "31", "-1", "2.5", "ten", "1e1", "100"]) assert.equal(parseDays(bad, 0, 30), null, bad);
  assert.equal(parseDays("60", 0, 60), 60);
  assert.equal(parseDays("61", 0, 60), null);
});

test("Sprint 6: the form refuses a bad COD percent, grace, trial, email, phone and payment instructions with the backend's rules", () => {
  const base = { ...formFromSettings(settings), reason: "Plans" };
  assert.deepEqual(validateSettingsForm(base), {});
  assert.equal(validateSettingsForm({ ...base, codCommissionPercent: "" }).codCommissionPercent, "Enter the cash on delivery percent (0 for none).");
  assert.equal(validateSettingsForm({ ...base, codCommissionPercent: "101" }).codCommissionPercent, "Enter a percentage from 0 to 100.");
  assert.equal(validateSettingsForm({ ...base, codCommissionPercent: "0" }).codCommissionPercent, undefined);
  assert.equal(validateSettingsForm({ ...base, graceDays: "31" }).graceDays, "Enter a whole number of days from 0 to 30.");
  assert.equal(validateSettingsForm({ ...base, graceDays: "" }).graceDays, "Enter the grace period in days (0 for none).");
  assert.equal(validateSettingsForm({ ...base, trialDays: "61" }).trialDays, "Enter a whole number of days from 0 to 60.");
  assert.equal(validateSettingsForm({ ...base, trialDays: "60" }).trialDays, undefined);
  assert.equal(validateSettingsForm({ ...base, supportEmail: "not an email" }).supportEmail, "Enter a valid email address.");
  assert.equal(validateSettingsForm({ ...base, supportEmail: "" }).supportEmail, undefined);
  assert.equal(validateSettingsForm({ ...base, supportPhone: "call me" }).supportPhone, "Use digits, spaces, + - and brackets only, at most 30 characters.");
  assert.equal(validateSettingsForm({ ...base, supportPhone: "+92 300 1234567" }).supportPhone, undefined);
  assert.equal(validateSettingsForm({ ...base, paymentInstructions: "x".repeat(1001) }).paymentInstructions, "The payment instructions can be at most 1000 characters.");
  assert.equal(validateSettingsForm({ ...base, paymentInstructions: "x".repeat(1000) }).paymentInstructions, undefined);
});

test("Sprint 6: only a changed new setting counts as a change; the same value written differently does not", () => {
  const base = formFromSettings(filled);
  assert.deepEqual(changedSettingFields(base, filled), []);
  assert.deepEqual(changedSettingFields({ ...base, codCommissionPercent: "2.0" }, filled), []);
  assert.deepEqual(changedSettingFields({ ...base, graceDays: " 10 " }, filled), []);
  assert.deepEqual(changedSettingFields({ ...base, paymentInstructions: "  " + filled.paymentInstructions + " " }, filled), []);
  assert.deepEqual(changedSettingFields({ ...base, codCommissionPercent: "3" }, filled), ["codCommissionPercent"]);
  assert.deepEqual(changedSettingFields({ ...base, paymentInstructions: "" }, filled), ["paymentInstructions"]);
  assert.deepEqual(changedSettingFields({ ...base, graceDays: "11", trialDays: "15", supportEmail: "", supportPhone: "0311" }, filled), [
    "graceDays",
    "trialDays",
    "supportEmail",
    "supportPhone",
  ]);
  assert.deepEqual(changedSettingFields({ ...base, codCommissionPercent: "abc" }, filled), ["codCommissionPercent"]);
});

test("Sprint 6: the update sends only the new settings that changed, clears a blank text with null, and passes the contract", () => {
  const values = { ...formFromSettings(filled), codCommissionPercent: " 3.5 ", graceDays: "0", paymentInstructions: "  ", supportPhone: "  ", reason: " Plans " };
  const request = toUpdateRequest(values, filled);
  assert.deepEqual(request, { codCommissionPercent: 3.5, graceDays: 0, paymentInstructions: null, supportPhone: null, reason: "Plans" });
  assert.equal(adminSettingsUpdateRequestSchema.safeParse(request).success, true);
  const untouched = toUpdateRequest({ ...formFromSettings(settings), maxStoresPerSeller: "4", reason: "Bigger sellers" }, settings);
  for (const field of ["codCommissionPercent", "paymentInstructions", "graceDays", "trialDays", "supportEmail", "supportPhone"]) assert.equal(field in untouched, false, field);
});

test("Sprint 6: setting COD to 0 on a store that had 2 is a change with a real zero (not left out)", () => {
  const request = toUpdateRequest({ ...formFromSettings(filled), codCommissionPercent: "0", reason: "COD is free again" }, filled);
  assert.equal(request.codCommissionPercent, 0);
  assert.equal(adminSettingsUpdateRequestSchema.safeParse(request).success, true);
});

test("Sprint 6: the backend's issues land on the new fields too", () => {
  const errors = issuesToErrors([
    { path: "codCommissionPercent", message: "must be a number from 0 to 100" },
    { path: "graceDays", message: "must be a whole number from 0 to 30" },
    { path: "supportEmail", message: "must be an email address" },
  ]);
  assert.deepEqual(errors, {
    codCommissionPercent: "Must be a number from 0 to 100.",
    graceDays: "Must be a whole number from 0 to 30.",
    supportEmail: "Must be an email address.",
  });
});

test("S8-B5: the referral settings: 0 months is allowed (referrals off), out-of-range values are refused, only changes are sent", () => {
  const base = { ...formFromSettings(settings), reason: "Referrals" };
  assert.deepEqual(validateSettingsForm({ ...base, referralRewardMonths: "0", referralMonthlyCap: "100" }), {});
  for (const bad of ["", "13", "-1", "1.5"]) assert.ok(validateSettingsForm({ ...base, referralRewardMonths: bad }).referralRewardMonths, bad);
  for (const bad of ["", "101", "two"]) assert.ok(validateSettingsForm({ ...base, referralMonthlyCap: bad }).referralMonthlyCap, bad);
  assert.deepEqual(toUpdateRequest({ ...base, referralRewardMonths: "0" }, settings), { referralRewardMonths: 0, reason: "Referrals" });
  assert.deepEqual(changedSettingFields({ ...base, referralMonthlyCap: "6" }, settings), ["referralMonthlyCap"]);
});

test("Sprint 9: the minimum app versions are optional, checked, sent only when changed and cleared with a blank", () => {
  const form = formFromSettings({ ...settings, minSellerAppVersion: "1.2.0" });
  assert.equal(form.minSellerAppVersion, "1.2.0");
  assert.equal(form.minAdminAppVersion, "");
  const original = { ...settings, minSellerAppVersion: "1.2.0" };
  assert.deepEqual(changedSettingFields(form, original), []);
  assert.deepEqual(toUpdateRequest({ ...form, minSellerAppVersion: " ", minAdminAppVersion: "2.0", reason: "Old builds break" }, original), { minSellerAppVersion: null, minAdminAppVersion: "2.0", reason: "Old builds break" });
  const errors = validateSettingsForm({ ...form, minAdminAppVersion: "v2", reason: "x" });
  assert.ok(errors.minAdminAppVersion);
  assert.equal(errors.minSellerAppVersion, undefined);
});
