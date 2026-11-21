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

// Address book insights (Sprint 5 EP-10.US03.T02): the same address on an earlier order, and the other addresses.
import { addressInsights } from "./customer-view";
const book = [
  { address: "House 1, Street 2", city: "Lahore", orderCount: 3, lastUsedAt: "2026-11-07T10:00:00.000Z" },
  { address: "Flat 7, Mall Road", city: "Karachi", orderCount: 1, lastUsedAt: "2026-11-03T10:00:00.000Z" },
];
assert.deepEqual(addressInsights(book, " house 1,  street 2 ", "LAHORE").repeat, true);
assert.deepEqual(addressInsights(book, "house 1, street 2", "Lahore").others.map((entry) => entry.address), ["Flat 7, Mall Road"]);
assert.equal(addressInsights(book, "Flat 7, Mall Road", "Karachi").repeat, false, "used once: this order is the only one");
assert.equal(addressInsights(book, "Somewhere new", "Quetta").repeat, false);
assert.equal(addressInsights(book, "Somewhere new", "Quetta").others.length, 2);
assert.equal(addressInsights(book, "House 1, Street 2", "Karachi").repeat, false, "the same street in another city is another address");
assert.equal(addressInsights([], null, null).others.length, 0);
assert.equal(addressInsights(Array.from({ length: 9 }, (_, i) => ({ address: "A" + i, city: null, orderCount: 1, lastUsedAt: "2026-11-01T00:00:00.000Z" })), "x", null).others.length, 5);
