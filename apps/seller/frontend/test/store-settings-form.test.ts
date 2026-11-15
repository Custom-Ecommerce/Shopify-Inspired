import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changedFields,
  counter,
  groupPatch,
  isDirty,
  lastPaymentMethod,
  parseRupees,
  payoutProblem,
  quotePreview,
  searchCities,
  stableText,
} from "../lib/store-settings-form";

// Sprint 4 SB-5 B6: the pure helpers of the settings screen. No React, no network.

test("isDirty ignores key order and sees a real change", () => {
  assert.equal(isDirty({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), false);
  assert.equal(isDirty({ a: 1 }, { a: 2 }), true);
  assert.equal(isDirty({ a: null }, { a: undefined }), false);
  assert.equal(stableText({ b: 1, a: 2 }), stableText({ a: 2, b: 1 }));
});

test("groupPatch carries only the changed fields, and null when nothing changed", () => {
  const saved = { name: "Zara", city: "Lahore", description: "" };
  assert.equal(groupPatch(saved, { ...saved }), null);
  assert.deepEqual(groupPatch(saved, { ...saved, city: "Karachi" }), { city: "Karachi" });
  assert.deepEqual(changedFields(saved, { name: "Zara 2", city: "Lahore", description: "x" }), ["name", "description"]);
});

test("counter reports the characters used and whether the limit is passed", () => {
  assert.deepEqual(counter("abc", 5), { used: 3, left: 2, over: false });
  assert.equal(counter("abcdef", 5).over, true);
});

test("searchCities matches case-insensitively, puts prefixes first and skips cities already taken", () => {
  assert.equal(searchCities("kara")[0], "Karachi");
  assert.ok(searchCities("lah").includes("Lahore"));
  assert.ok(!searchCities("kara", 8, ["karachi"]).includes("Karachi"));
  assert.deepEqual(searchCities("zzzz"), []);
  assert.equal(searchCities("", 3).length, 3);
});

test("parseRupees reads whole rupees, empty as null and anything else as NaN", () => {
  assert.equal(parseRupees("1,500"), 1500);
  assert.equal(parseRupees(""), null);
  assert.ok(Number.isNaN(parseRupees("12.5")));
  assert.ok(Number.isNaN(parseRupees("abc")));
});

test("the quote preview uses the shared delivery rule (the server prices checkout with the same function)", () => {
  const draft = { defaultRate: 250, freeOver: 5000, cityRates: [{ city: "Karachi", rate: 400 }] };
  assert.equal(quotePreview(draft, "Karachi", 3000).charge, 400);
  assert.equal(quotePreview(draft, "karachi", 3000).charge, 400);
  assert.equal(quotePreview(draft, "Lahore", 3000).charge, 250);
  assert.equal(quotePreview(draft, null, 100).charge, 250);
  assert.equal(quotePreview(draft, "Lahore", 5000).free, true);
  assert.equal(quotePreview(draft, "Lahore", 5000).charge, 0);
  assert.equal(quotePreview(draft, "Karachi", 4999).free, false);
  assert.equal(quotePreview({ ...draft, freeOver: null }, "Lahore", 999999).charge, 250);
});

test("the last payment method cannot be switched off", () => {
  assert.equal(lastPaymentMethod({ codEnabled: true, cardEnabled: false }, "codEnabled"), true);
  assert.equal(lastPaymentMethod({ codEnabled: true, cardEnabled: true }, "codEnabled"), false);
  assert.equal(lastPaymentMethod({ codEnabled: false, cardEnabled: true }, "cardEnabled"), true);
});

test("the payout form needs the number entered twice", () => {
  const ok = { method: "bank", accountTitle: "Zara", accountNumber: "PK36 SCBL 0000 0011 2345 6702", confirmNumber: "pk36scbl0000001123456702", bankName: "HBL" };
  assert.equal(payoutProblem(ok), null);
  assert.match(payoutProblem({ ...ok, confirmNumber: "PK00" }) ?? "", /not the same/);
  assert.match(payoutProblem({ ...ok, bankName: "" }) ?? "", /bank name/i);
  assert.equal(payoutProblem({ ...ok, method: "easypaisa", bankName: "" }), null);
});
