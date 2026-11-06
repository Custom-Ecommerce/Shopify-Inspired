/*
 * Checks for the backend's pure cart quote: pricing, stock, and the rule that lines which cannot be bought stay out of
 * the totals. No database. From apps/seller/backend run:
 *
 *   npx tsx test/cart-quote.check.ts
 */
import assert from "node:assert/strict";
import { buildCartQuote, mergeQuoteLines, type QuoteCatalogRow } from "../src/lib/storefront/cart-quote";

const variant = { _id: "v1", title: "Default", price: 1000, trackQuantity: true, stockQuantity: 10 };

const kurta: QuoteCatalogRow = { title: "Cotton Kurta", deliveryCharge: null, variants: [variant] };

const line = (productId: string, qty: number) => ({ productId, variantId: null, qty });

const store = { deliveryRate: 200, freeDeliveryThreshold: 5000 };

const checks: { name: string; run: () => void }[] = [];
function check(name: string, run: () => void): void {
  checks.push({ name, run });
}

check("a purchasable line is priced from the catalog, and the store's delivery rate is charged once", () => {
  const quote = buildCartQuote([line("a", 2)], new Map([["a", kurta]]), store);
  assert.equal(quote.lines[0].lineTotal, 2000);
  assert.equal(quote.lines[0].issue, null);
  assert.equal(quote.subtotal, 2000);
  assert.equal(quote.deliveryCharges, 200);
  assert.equal(quote.total, 2200);
  assert.equal(quote.canCheckout, true);
});

check("free delivery applies at the store's threshold, and a product's own charge wins over the store rate", () => {
  const big = buildCartQuote([line("a", 5)], new Map([["a", kurta]]), store);
  assert.equal(big.deliveryCharges, 0, "5 x 1000 reaches the 5000 threshold");
  const own = buildCartQuote([line("a", 1)], new Map([["a", { ...kurta, deliveryCharge: 350 }]]), store);
  assert.equal(own.deliveryCharges, 350);
});

check("an out-of-stock line is reported and left out of the totals", () => {
  const sold = { ...kurta, variants: [{ ...variant, stockQuantity: 0 }] };
  const quote = buildCartQuote(
    [
      line("a", 1),
      line("b", 1),
    ],
    new Map([
      ["a", kurta],
      ["b", sold],
    ]),
    store,
  );
  assert.equal(quote.lines[1].issue, "out_of_stock");
  assert.equal(quote.lines[1].lineTotal, null);
  assert.equal(quote.subtotal, 1000, "only the purchasable line is in the subtotal");
  assert.equal(quote.canCheckout, false);
});

check("a quantity the free units cannot cover is insufficient, and reports what is left", () => {
  const scarce = { ...kurta, variants: [{ ...variant, stockQuantity: 2 }] };
  const quote = buildCartQuote([line("a", 3)], new Map([["a", scarce]]), store);
  assert.equal(quote.lines[0].issue, "insufficient_stock");
  assert.equal(quote.lines[0].availableQty, 2);
  assert.equal(quote.canCheckout, false);
});

check("an unknown product, or one whose price is not usable, is unknown and has no title", () => {
  const quote = buildCartQuote(
    [
      line("missing", 1),
      line("broken", 1),
    ],
    new Map([["broken", { ...kurta, variants: [{ ...variant, price: Number.NaN }] }]]),
    store,
  );
  assert.equal(quote.lines[0].issue, "unknown_product");
  assert.equal(quote.lines[0].title, null);
  assert.equal(quote.lines[1].issue, "unknown_product");
  assert.equal(quote.total, 0);
});

check("an empty cart cannot be checked out and has no totals", () => {
  const quote = buildCartQuote([], new Map(), store);
  assert.deepEqual(quote.lines, []);
  assert.equal(quote.total, 0);
  assert.equal(quote.canCheckout, false);
});

check("repeated products merge into one line with the summed quantity, as the order does", () => {
  assert.deepEqual(
    mergeQuoteLines([
      { productId: "ABC", qty: 2 },
      { productId: "abc", qty: 3 },
      { productId: "def", qty: 1 },
    ]),
    [
      { productId: "abc", variantId: null, qty: 5 },
      { productId: "def", variantId: null, qty: 1 },
    ],
  );
});

let failed = 0;
for (const { name, run } of checks) {
  try {
    run();
    console.log("ok    " + name);
  } catch (error) {
    failed += 1;
    console.error("FAIL  " + name);
    console.error(error);
  }
}
console.log(checks.length - failed + "/" + checks.length + " checks passed");
if (failed > 0) process.exitCode = 1;
