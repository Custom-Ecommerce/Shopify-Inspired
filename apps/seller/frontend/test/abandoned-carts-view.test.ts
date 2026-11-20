import { test } from "node:test";
import assert from "node:assert/strict";
import { CART_TABS, cartErrorText, cartListQuery, cartWhatsappText, itemLine, minutesAgoText } from "../lib/abandoned-carts-view";
import { whatsappLink } from "@markaz/notifications/whatsapp";

// Sprint 5 EP-28.US01.T04 (D-107): the pure rules of the seller's Abandoned carts page.

test("the status tabs send ?status= (the backend reads exactly that), all sends none, and nothing sends where[...]", () => {
  assert.equal(cartListQuery("open"), "status=open&page=1&limit=20");
  assert.equal(cartListQuery("contacted", 3, 50), "status=contacted&page=3&limit=50");
  assert.equal(cartListQuery("recovered"), "status=recovered&page=1&limit=20");
  assert.equal(cartListQuery("all"), "page=1&limit=20");
  for (const tab of CART_TABS) assert.equal(cartListQuery(tab.value).includes("where"), false, tab.value);
  assert.deepEqual(CART_TABS.map((tab) => tab.value), ["open", "contacted", "recovered", "all"]);
});

test("how long ago: just now, minutes, hours, days", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString();
  assert.equal(minutesAgoText(ago(0), now), "just now");
  assert.equal(minutesAgoText(ago(0.4), now), "just now");
  assert.equal(minutesAgoText(ago(12), now), "12 min ago");
  assert.equal(minutesAgoText(ago(59), now), "59 min ago");
  assert.equal(minutesAgoText(ago(180), now), "3 h ago");
  assert.equal(minutesAgoText(ago(60 * 24 * 2), now), "2 d ago");
  assert.equal(minutesAgoText(new Date(now + 5 * 60_000).toISOString(), now), "just now", "a clock a little ahead never reads negative");
});

test("one line per item: the name, the variant (not the Default one) and the quantity", () => {
  assert.equal(itemLine({ productTitle: "Lawn suit", variantTitle: "Blue", quantity: 2 }), "Lawn suit (Blue) x 2");
  assert.equal(itemLine({ productTitle: "Cap", variantTitle: "Default", quantity: 1 }), "Cap x 1");
  assert.equal(itemLine({ productTitle: "Cap", variantTitle: "", quantity: 1 }), "Cap x 1");
});

test("the wa.me message names the store and the first items, in English then Urdu, and the link carries it to the shopper's number", () => {
  const items = [
    { productTitle: "Lawn suit", variantTitle: "Blue", quantity: 2 },
    { productTitle: "Dupatta", variantTitle: "Default", quantity: 1 },
  ];
  const text = cartWhatsappText("Zara Lawn", items);
  assert.match(text, /this is Zara Lawn/);
  assert.match(text, /Lawn suit \(Blue\) x 2, Dupatta x 1/);
  assert.match(text, /[؀-ۿ]/, "Urdu follows English");
  assert.equal(text.includes(" and "), false, "no more items to count");
  const many = cartWhatsappText("Zara Lawn", [...items, ...items, ...items]);
  assert.match(many, /and 3 more/);
  const link = whatsappLink("+923001234567", text);
  assert.ok(link !== null && link.startsWith("https://wa.me/923001234567?text="));
  assert.equal(link!.includes("Zara%20Lawn"), true);
  assert.equal(whatsappLink("12345", text), null, "a number that is not a Pakistani mobile has no link");
});

test("the backend's own words are shown for a failure, else one generic sentence", () => {
  assert.equal(cartErrorText({ errors: [{ message: "This cart was already marked." }], code: "ABANDONED_CART_STATUS_CHANGED" }), "This cart was already marked.");
  assert.equal(cartErrorText({ errors: [] }), "Something went wrong. Please try again.");
  assert.equal(cartErrorText(null), "Something went wrong. Please try again.");
  assert.equal(cartErrorText({ errors: [{ message: "" }] }), "Something went wrong. Please try again.");
});
