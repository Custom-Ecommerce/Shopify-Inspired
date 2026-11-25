import { test } from "node:test";
import assert from "node:assert/strict";
import { GATEWAY_ONLY_NOTE, PLATFORM_RATE_DESCRIPTION, STORE_RATE_DESCRIPTION, describeRateChange, parseRateInput } from "../lib/commission-rates";

// Sprint 6 EP-12.US04.T04 (D-116): the default-commission and store-rate screens say they apply to gateway orders only.

test("every rate screen text says gateway (card) orders, and none of them promises COD", () => {
  for (const text of [GATEWAY_ONLY_NOTE, PLATFORM_RATE_DESCRIPTION, STORE_RATE_DESCRIPTION]) {
    assert.match(text, /gateway/i);
    assert.match(text, /card/i);
  }
  assert.match(GATEWAY_ONLY_NOTE, /cash on delivery/i);
  assert.match(STORE_RATE_DESCRIPTION, /never to cash on delivery/i);
  assert.match(PLATFORM_RATE_DESCRIPTION, /COD percent in Settings/);
});

test("the confirmation sentence says gateway orders only and that no ledger entry is rewritten", () => {
  const text = describeRateChange("Zara Lawn", null, 6, 4);
  assert.match(text, /^Zara Lawn: the platform default \(4%\) to 6%\./);
  assert.match(text, /gateway \(card\) orders/);
  assert.match(text, /never to cash on delivery/);
  assert.match(text, /existing ledger entries are not rewritten/);
});

test("the rate input rules are unchanged: 0 to 100 with at most one decimal", () => {
  assert.equal(parseRateInput("4"), 4);
  assert.equal(parseRateInput("4,5"), 4.5);
  assert.equal(parseRateInput("100"), 100);
  assert.equal(parseRateInput("100.1"), null);
  assert.equal(parseRateInput("4.55"), null);
  assert.equal(parseRateInput("abc"), null);
});
