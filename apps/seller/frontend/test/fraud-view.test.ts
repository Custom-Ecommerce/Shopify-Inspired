import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_REASON_MAX,
  CONFIRMATION_NOTE_MAX,
  MODE_COPY,
  RISK_FLAG_LABEL,
  RISK_FLAG_WHY,
  blockProblem,
  confirmationErrorText,
  confirmationMessage,
  confirmationNoteProblem,
  readFlags,
  readStatus,
  riskRulesBody,
  telHref,
} from "../lib/fraud-view";

// Sprint 5 EP-11 (D-107): the pure helpers of the confirmation panel, the flag chips, the blocklist form and the Fraud tab.

test("a status from an older backend, or nothing, reads as not_required; flags keep only the real ones in the fixed order", () => {
  assert.equal(readStatus(undefined), "not_required");
  assert.equal(readStatus("banana"), "not_required");
  for (const status of ["unconfirmed", "confirmed", "unreachable"]) assert.equal(readStatus(status), status);
  assert.deepEqual(readFlags(undefined), []);
  assert.deepEqual(readFlags(["new_customer", "x", "high_value", "high_value"]), ["high_value", "new_customer"]);
});

test("every flag has a label and a reason for the seller", () => {
  for (const flag of ["high_value", "flagged_city", "repeat_returns", "new_customer"] as const) {
    assert.ok(RISK_FLAG_LABEL[flag].length > 0, flag);
    assert.ok(RISK_FLAG_WHY[flag].length > 0, flag);
  }
});

test("telHref keeps digits and a leading plus, and is null when there is nothing to dial", () => {
  assert.equal(telHref("+923001234567"), "tel:+923001234567");
  assert.equal(telHref("0300 123-4567"), "tel:03001234567");
  assert.equal(telHref("+92 (300) 1234567"), "tel:+923001234567");
  for (const none of [null, undefined, "", "   ", "abc", "123"]) assert.equal(telHref(none), null, String(none));
});

test("the WhatsApp text is English then Urdu and names the store, the customer, the order and the total", () => {
  const text = confirmationMessage({ storeName: "Zara Lawn", customerName: "Sara Khan", orderNumber: "ORD-ABCD2345", total: "Rs. 3,250" });
  const [english, urdu] = text.split("\n");
  assert.match(english!, /Sara Khan/);
  assert.match(english!, /Zara Lawn/);
  assert.match(english!, /ORD-ABCD2345/);
  assert.match(english!, /Rs\. 3,250/);
  assert.match(english!, /cash on delivery/);
  assert.match(urdu!, /[؀-ۿ]/, "the second line is Urdu");
  assert.match(urdu!, /ORD-ABCD2345/);
  assert.match(urdu!, /Zara Lawn/);
  const bare = confirmationMessage({ storeName: "  ", customerName: null, orderNumber: "ORD-1", total: "Rs. 1" });
  assert.match(bare, /Hi there, this is our store/);
});

test("a decision note: at most 200 characters, no angle brackets", () => {
  assert.equal(confirmationNoteProblem(""), null);
  assert.equal(confirmationNoteProblem("x".repeat(CONFIRMATION_NOTE_MAX)), null);
  assert.match(confirmationNoteProblem("x".repeat(CONFIRMATION_NOTE_MAX + 1)) ?? "", /200/);
  assert.match(confirmationNoteProblem("a <b>") ?? "", /< or >/);
});

test("errors of the decision are said in words: 409 means already decided", () => {
  assert.match(confirmationErrorText(409, "ORDER_CONFIRMATION_DECIDED"), /already decided/);
  assert.match(confirmationErrorText(404, null), /not found/);
  assert.match(confirmationErrorText(500, null), /could not be saved/);
});

test("the blocklist form: a phone in any spelling or an email, a reason of up to 100 characters", () => {
  for (const value of ["03001234567", "0300 1234567", "+92 300 1234567", "923001234567", "0092 300 1234567"]) {
    assert.equal(blockProblem({ kind: "phone", value, reason: "" }), null, value);
  }
  for (const value of ["", "abc", "12345", "+441234567890", "0900 1234567"]) assert.notEqual(blockProblem({ kind: "phone", value, reason: "" }), null, value);
  assert.equal(blockProblem({ kind: "email", value: "Fraud@Example.pk", reason: "" }), null);
  for (const value of ["", "nope", "a@b", "a b@c.pk"]) assert.notEqual(blockProblem({ kind: "email", value, reason: "" }), null, value);
  assert.equal(blockProblem({ kind: "phone", value: "03001234567", reason: "r".repeat(BLOCK_REASON_MAX) }), null);
  assert.match(blockProblem({ kind: "phone", value: "03001234567", reason: "r".repeat(BLOCK_REASON_MAX + 1) }) ?? "", /100/);
  assert.match(blockProblem({ kind: "phone", value: "03001234567", reason: "<x>" }) ?? "", /< or >/);
});

test("the risk rules form: empty means no rule; bad values are named by the server's field path", () => {
  assert.deepEqual(riskRulesBody({ orderValue: "", returns: "", cities: [] }), {
    body: { flagOrderValueAbove: null, flaggedCities: [], flagReturnsAtLeast: null },
    errors: {},
  });
  assert.deepEqual(riskRulesBody({ orderValue: "15,000", returns: "2", cities: ["Karachi"] }).body, {
    flagOrderValueAbove: 15000,
    flaggedCities: ["Karachi"],
    flagReturnsAtLeast: 2,
  });
  for (const orderValue of ["0", "-5", "1.5", "abc", "10000001", "123456789"]) {
    const result = riskRulesBody({ orderValue, returns: "", cities: [] });
    assert.equal(result.body, null, orderValue);
    assert.deepEqual(Object.keys(result.errors), ["fraud.riskRules.flagOrderValueAbove"], orderValue);
  }
  for (const returns of ["0", "11", "2.5", "x"]) {
    assert.deepEqual(Object.keys(riskRulesBody({ orderValue: "", returns, cities: [] }).errors), ["fraud.riskRules.flagReturnsAtLeast"], returns);
  }
  assert.deepEqual(Object.keys(riskRulesBody({ orderValue: "", returns: "", cities: Array.from({ length: 31 }, (_, i) => "City " + i) }).errors), ["fraud.riskRules.flaggedCities"]);
  assert.equal(riskRulesBody({ orderValue: "", returns: "", cities: Array.from({ length: 30 }, (_, i) => "City " + i) }).body?.flaggedCities.length, 30);
});

test("the three modes are offered in order, with plain words", () => {
  assert.deepEqual(MODE_COPY.map((mode) => mode.value), ["off", "flagged", "all"]);
  for (const mode of MODE_COPY) assert.ok(mode.label.length > 0 && mode.description.length > 0);
});
