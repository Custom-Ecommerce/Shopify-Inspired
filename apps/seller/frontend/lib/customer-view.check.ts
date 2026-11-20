/*
 * Sprint 5 EP-10.US02: checks for lib/customer-view.ts. Plain asserts, no test runner, like variant-matrix.check.ts.
 * Run: node --import tsx lib/customer-view.check.ts
 */
import assert from "node:assert/strict";
import { DEFAULT_CUSTOMER_FILTERS, customerPath, displayName, displayPhone, filterQuery, noteProblem, parseTags } from "./customer-view";

// The default filters add nothing to the query; the paging is the caller's.
assert.equal(filterQuery(DEFAULT_CUSTOMER_FILTERS), "");
assert.equal(filterQuery(DEFAULT_CUSTOMER_FILTERS, { page: 2, limit: 20 }), "page=2&limit=20");
assert.equal(filterQuery({ q: "  ayesha ", sort: "total_spent", repeat: true, hasEmail: true, unsubscribed: true })
  , "q=ayesha&sort=total_spent&repeat=1&hasEmail=1&unsubscribed=1");
// Search text is encoded, never concatenated.
assert.equal(filterQuery({ ...DEFAULT_CUSTOMER_FILTERS, q: "a&b=c" }), "q=a%26b%3Dc");

// A phone key is encoded in the path (the plus sign must survive).
assert.equal(customerPath("/s/abc", "+923001234567"), "/s/abc/customers/%2B923001234567");
assert.equal(customerPath("/s/abc", "a@b.com"), "/s/abc/customers/a%40b.com");

assert.equal(displayPhone("+923001234567"), "0300 1234567");
assert.equal(displayPhone(null), "");
assert.equal(displayPhone("+441234"), "+441234");
assert.equal(displayName("  Ayesha ", "+923001234567", null), "Ayesha");
assert.equal(displayName(null, "+923001234567", "a@b.com"), "0300 1234567");
assert.equal(displayName(null, null, "a@b.com"), "a@b.com");
assert.equal(displayName(null, null, null), "Customer");

// Tags: comma separated, trimmed, no empties, a repeat in another case is dropped.
assert.deepEqual(parseTags(" VIP, repeat ,, vip ,Eid  buyer"), ["VIP", "repeat", "Eid buyer"]);
assert.deepEqual(parseTags(""), []);

assert.equal(noteProblem("fine", ["a"]), null);
assert.match(noteProblem("x".repeat(501), []) ?? "", /500/);
assert.match(noteProblem("<b>", []) ?? "", /cannot contain/);
assert.match(noteProblem("", ["1", "2", "3", "4", "5", "6"]) ?? "", /at most 5/);
assert.match(noteProblem("", ["x".repeat(21)]) ?? "", /20/);

console.log("customer view checks passed");
