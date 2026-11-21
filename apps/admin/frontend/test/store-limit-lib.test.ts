import { test } from "node:test";
import assert from "node:assert/strict";
import { sellerStoreLimitRequestSchema } from "../lib/contracts";
import {
  STORE_LIMIT_SOURCE_LABELS,
  describeEffectiveLimit,
  isUnchanged,
  limitWithoutOverride,
  overLimitNote,
  parseStoreLimitInput,
  storeLimitIssuesToErrors,
  storesLabel,
  toStoreLimitRequest,
  validateStoreLimitForm,
} from "../lib/store-limit";

// Sprint 6 EP-12.US02.T03 (D-118): the wording, checks and request of the Store limit dialog. Pure functions.

const view = { storeLimitOverride: null, effectiveLimit: 3, source: "env" as const, storesUsed: 2, planLimit: null, platformMax: null, envMax: 3 };

test("a store limit is a whole number from 1 to 1000 and nothing else", () => {
  for (const good of ["1", "3", " 10 ", "1000"]) assert.notEqual(parseStoreLimitInput(good), null, good);
  for (const bad of ["", "0", "1001", "2.5", "-3", "ten", "1e2", "10000"]) assert.equal(parseStoreLimitInput(bad), null, bad);
  assert.equal(parseStoreLimitInput(" 10 "), 10);
});

test("the dialog says the effective limit, where it comes from, and how many stores the seller has", () => {
  assert.equal(storesLabel(1), "1 store");
  assert.equal(storesLabel(3), "3 stores");
  assert.equal(describeEffectiveLimit({ effectiveLimit: 5, source: "override", storesUsed: 2 }), "Effective limit: 5 stores (Set for this seller by an operator (override)). The seller has 2 stores.");
  assert.match(describeEffectiveLimit({ effectiveLimit: 3, source: "plan", storesUsed: 1 }), /subscription plan/);
  assert.match(describeEffectiveLimit({ effectiveLimit: 3, source: "setting", storesUsed: 1 }), /Stores per seller/);
  assert.match(describeEffectiveLimit({ effectiveLimit: 3, source: "env", storesUsed: 1 }), /environment/);
  assert.deepEqual(Object.keys(STORE_LIMIT_SOURCE_LABELS), ["override", "plan", "setting", "env"]);
});

test("without the override the limit would come from the plan, then the platform setting, then the environment", () => {
  assert.deepEqual(limitWithoutOverride({ planLimit: 3, platformMax: 5, envMax: 9 }), { limit: 3, source: "plan" });
  assert.deepEqual(limitWithoutOverride({ planLimit: null, platformMax: 5, envMax: 9 }), { limit: 5, source: "setting" });
  assert.deepEqual(limitWithoutOverride({ planLimit: null, platformMax: null, envMax: 9 }), { limit: 9, source: "env" });
});

test("a valid form has no errors; a bad limit and a short or long reason are named", () => {
  assert.deepEqual(validateStoreLimitForm({ clear: false, value: "5", reason: "Agency account" }), {});
  assert.deepEqual(validateStoreLimitForm({ clear: true, value: "", reason: "Back to the plan" }), {});
  assert.equal(validateStoreLimitForm({ clear: false, value: "", reason: "Agency account" }).value, "Enter a store limit.");
  assert.equal(validateStoreLimitForm({ clear: false, value: "0", reason: "Agency account" }).value, "Enter a whole number from 1 to 1000.");
  assert.equal(validateStoreLimitForm({ clear: false, value: "5", reason: "no" }).reason, "Give a reason of 3 to 300 characters.");
  assert.equal(validateStoreLimitForm({ clear: false, value: "5", reason: "x".repeat(301) }).reason, "Give a reason of 3 to 300 characters.");
  assert.equal(validateStoreLimitForm({ clear: true, value: "abc", reason: "Back to the plan" }).value, undefined, "the typed value is ignored when clearing");
});

test("the request carries the number or null, with the trimmed reason, and passes the contract", () => {
  const set = toStoreLimitRequest({ clear: false, value: " 5 ", reason: "  Agency account  " });
  assert.deepEqual(set, { storeLimitOverride: 5, reason: "Agency account" });
  assert.equal(sellerStoreLimitRequestSchema.safeParse(set).success, true);
  const cleared = toStoreLimitRequest({ clear: true, value: "5", reason: "Back to the plan" });
  assert.deepEqual(cleared, { storeLimitOverride: null, reason: "Back to the plan" });
  assert.equal(sellerStoreLimitRequestSchema.safeParse(cleared).success, true);
});

test("an override equal to the current one, or clearing none, is not a change", () => {
  assert.equal(isUnchanged({ clear: true, value: "", reason: "x" }, view), true);
  assert.equal(isUnchanged({ clear: true, value: "", reason: "x" }, { storeLimitOverride: 5 }), false);
  assert.equal(isUnchanged({ clear: false, value: "5", reason: "x" }, { storeLimitOverride: 5 }), true);
  assert.equal(isUnchanged({ clear: false, value: " 5 ", reason: "x" }, { storeLimitOverride: 5 }), true);
  assert.equal(isUnchanged({ clear: false, value: "6", reason: "x" }, { storeLimitOverride: 5 }), false);
  assert.equal(isUnchanged({ clear: false, value: "6", reason: "x" }, view), false);
});

test("lowering the limit below what the seller has says they keep their stores and cannot add more", () => {
  assert.equal(overLimitNote(2, 3), null);
  assert.equal(overLimitNote(3, 3), null);
  assert.match(overLimitNote(4, 2)!, /already has 4 stores/);
  assert.match(overLimitNote(4, 2)!, /keep them all and cannot add more/);
  assert.match(overLimitNote(2, 1)!, /already has 2 stores/);
});

test("the backend's issues land on the matching fields, capitalised; other issues are dropped", () => {
  assert.deepEqual(
    storeLimitIssuesToErrors([
      { path: "storeLimitOverride", message: "The store limit must be at least 1." },
      { path: "reason", message: "a reason of 3 to 300 characters is required" },
      { path: "body", message: "something else" },
    ]),
    { value: "The store limit must be at least 1.", reason: "A reason of 3 to 300 characters is required." },
  );
});
