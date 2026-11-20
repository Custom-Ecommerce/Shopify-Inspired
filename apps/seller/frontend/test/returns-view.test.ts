import { test } from "node:test";
import assert from "node:assert/strict";
import { RETURN_TABS, defaultReceiveRows, listQuery, receiveBody, refundLeft, refundProblem, rejectProblem, returnErrorText } from "../lib/returns-view";

// Sprint 5 EP-13 (D-107, D-108): the pure rules of the seller's Returns page.

test("the status tabs send ?status= (the page used to send where[status][equals], which the backend never read)", () => {
  assert.equal(listQuery("requested"), "status=requested&page=1&limit=20");
  assert.equal(listQuery("received", 3, 50), "status=received&page=3&limit=50");
  assert.equal(listQuery("all"), "page=1&limit=20", "all sends no status at all");
  for (const tab of RETURN_TABS) assert.equal(listQuery(tab.value).includes("where"), false, tab.value);
  assert.deepEqual(RETURN_TABS.map((tab) => tab.value), ["requested", "approved", "received", "refunded", "rejected", "all"]);
});

test("a rejection needs a reason of at least 5 characters, plain text", () => {
  assert.notEqual(rejectProblem(""), null);
  assert.notEqual(rejectProblem("no"), null);
  assert.notEqual(rejectProblem("    abc    "), null, "spaces do not count");
  assert.equal(rejectProblem("Used item"), null);
  assert.notEqual(rejectProblem("x".repeat(201)), null);
  assert.notEqual(rejectProblem("a <b> reason"), null);
});

test("what is left to refund: the cap less the recorded total, never below 0, nothing before the items are received", () => {
  assert.equal(refundLeft(1000, 300), 700);
  assert.equal(refundLeft(1000, 1000), 0);
  assert.equal(refundLeft(1000, 1200), 0);
  assert.equal(refundLeft(null, 0), 0);
});

test("a refund: whole rupees, at least 1, at most what is left, a short reference", () => {
  const ok = { amount: "500", left: 700, reference: "JC-1234" };
  assert.equal(refundProblem(ok), null);
  assert.equal(refundProblem({ ...ok, amount: "1,000", left: 1000 }), null, "thousands separators are read");
  for (const amount of ["", "0", "-5", "1.5", "abc", "701"]) assert.notEqual(refundProblem({ ...ok, amount }), null, amount);
  assert.match(refundProblem({ ...ok, amount: "701" }) ?? "", /700/);
  assert.notEqual(refundProblem({ ...ok, reference: "r".repeat(101) }), null);
  assert.notEqual(refundProblem({ ...ok, reference: "<x>" }), null);
});

test("the receive form starts with every line at the quantity asked for, to be restocked, and sends only what came back", () => {
  const items = [
    { productId: "p1", variantId: "v1", quantity: 2 },
    { productId: "p2", variantId: "v2", quantity: 1 },
  ];
  const rows = defaultReceiveRows(items);
  assert.deepEqual(rows.map((row) => [row.quantity, row.restock, row.asked]), [["2", true, 2], ["1", true, 1]]);
  assert.deepEqual(receiveBody(rows).body, {
    items: [
      { productId: "p1", variantId: "v1", quantity: 2, restock: true },
      { productId: "p2", variantId: "v2", quantity: 1, restock: true },
    ],
  });
  // A line with 0 left out, a line not restocked kept.
  const partial = receiveBody([{ ...rows[0]!, quantity: "0" }, { ...rows[1]!, restock: false }]);
  assert.deepEqual(partial.body, { items: [{ productId: "p2", variantId: "v2", quantity: 1, restock: false }] });
});

test("the receive form refuses more than was asked for, a non-number, and nothing at all", () => {
  const rows = defaultReceiveRows([{ productId: "p1", variantId: "v1", quantity: 2 }]);
  assert.notEqual(receiveBody([{ ...rows[0]!, quantity: "3" }]).problem, null);
  assert.notEqual(receiveBody([{ ...rows[0]!, quantity: "two" }]).problem, null);
  assert.notEqual(receiveBody([{ ...rows[0]!, quantity: "0" }]).problem, null);
  assert.notEqual(receiveBody([]).problem, null);
  assert.equal(receiveBody([{ ...rows[0]!, quantity: "3" }]).body, null);
});

test("errors of the return actions are said in words", () => {
  assert.match(returnErrorText(409, "RETURN_STATUS_CHANGED"), /refreshed/);
  assert.match(returnErrorText(422, "CARD_REFUND_UNSUPPORTED"), /card/i);
  assert.match(returnErrorText(422, "REFUND_EXCEEDS_CAP"), /left to refund/);
  assert.match(returnErrorText(404, null), /not found/);
  assert.match(returnErrorText(500, null), /could not be saved/);
});

import { returnWindowProblem } from "../lib/returns-view";

test("the return window is a whole number of days from 0 to 30", () => {
  for (const ok of ["0", "7", "30", " 14 "]) assert.equal(returnWindowProblem(ok), null, ok);
  for (const bad of ["", "-1", "31", "7.5", "abc", "100"]) assert.notEqual(returnWindowProblem(bad), null, bad);
});
