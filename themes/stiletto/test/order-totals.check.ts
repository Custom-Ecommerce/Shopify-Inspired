/*
 * Checks for Sprint 8 (S8-B1, D-118): the money rows of Stiletto's order confirmation, and that the cart drawer and the checkout show the tax line the server quoted. The
 * logic lives in pure files (the adapter and storefront-data's tax line); the components only render what they are given, and these checks read their source for it.
 * No test runner is needed. From themes/stiletto run (the workspace runner uses packages/storefront-data for tsx):
 *
 *   npx tsx test/order-totals.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orderTotalRows } from "../src/adapters/order-totals";

const checks: Array<[string, () => void]> = [];
const check = (name: string, run: () => void): void => {
  checks.push([name, run]);
};

const base = { subtotal: 3000, discount: 0, deliveryCharges: 250, total: 3250 };
const source = (file: string): string => readFileSync(new URL("../" + file, import.meta.url), "utf8");

check("an order with no tax reads exactly as it did: subtotal, delivery, total", () => {
  const rows = orderTotalRows({ ...base });
  assert.deepEqual(rows.map((row) => row.key), ["subtotal", "delivery", "total"]);
  assert.equal(rows.at(-1)?.strong, true);
  assert.equal(rows.some((row) => row.key === "tax"), false);
  const zero = orderTotalRows({ ...base, taxAmount: 0, taxMode: "exclusive", taxLabel: "Tax" });
  assert.deepEqual(zero, rows, "a tax of 0 shows no line");
});

check("an exclusive tax shows as the store's label, between delivery and the total, and the total includes it", () => {
  const rows = orderTotalRows({ ...base, total: 3760, taxAmount: 510, taxMode: "exclusive", taxLabel: "GST" });
  assert.deepEqual(rows.map((row) => row.key), ["subtotal", "delivery", "tax", "total"]);
  const tax = rows.find((row) => row.key === "tax");
  assert.equal(tax?.label, "GST");
  assert.equal(tax?.value, "Rs. 510");
  assert.equal(rows.at(-1)?.value, "Rs. 3,760");
});

check("an inclusive tax shows as 'Tax (included)' and the total is the unchanged one", () => {
  const rows = orderTotalRows({ ...base, taxAmount: 436, taxMode: "inclusive", taxLabel: "Tax" });
  const tax = rows.find((row) => row.key === "tax");
  assert.equal(tax?.label, "Tax (included)");
  assert.equal(tax?.value, "Rs. 436");
  assert.equal(rows.at(-1)?.value, "Rs. 3,250");
  assert.equal(orderTotalRows({ ...base, taxAmount: 436, taxMode: "inclusive", taxLabel: "VAT" }).find((row) => row.key === "tax")?.label, "VAT (included)");
});

check("a missing label falls back to 'Tax'; the discount row stays above delivery", () => {
  const rows = orderTotalRows({ ...base, discount: 300, total: 3510, taxAmount: 459, taxMode: "exclusive", taxLabel: null });
  assert.deepEqual(rows.map((row) => row.key), ["subtotal", "discount", "delivery", "tax", "total"]);
  assert.equal(rows.find((row) => row.key === "tax")?.label, "Tax");
  assert.equal(rows.find((row) => row.key === "discount")?.value, "-Rs. 300");
  assert.equal(orderTotalRows({ ...base, taxAmount: 10, taxMode: "exclusive" }).find((row) => row.key === "tax")?.label, "Tax");
});

check("delivery still reads 'Free' at 0 and is never part of the tax rows", () => {
  const rows = orderTotalRows({ subtotal: 6000, discount: 0, deliveryCharges: 0, total: 6600, taxAmount: 600, taxMode: "exclusive", taxLabel: "Tax" });
  assert.equal(rows.find((row) => row.key === "delivery")?.value, "Free");
  assert.equal(rows.find((row) => row.key === "tax")?.value, "Rs. 600");
});

check("the order confirmation page renders its money rows from the adapter", () => {
  const page = source("src/pages/order-confirmation-page.tsx");
  assert.match(page, /orderTotalRows\(order\)/);
  assert.doesNotMatch(page, /label="Delivery"/, "the rows are not hand-written in the page any more");
});

check("the checkout summary and the cart drawer show the tax line only when the server quoted one", () => {
  const adapter = source("src/adapters/checkout.ts");
  assert.match(adapter, /priced \? priced\.tax : null/, "the adapter takes the tax from the server's quote and never calculates it");
  assert.doesNotMatch(adapter, /taxAmount \*|ratePercent/, "no tax arithmetic in the theme");
  const checkout = source("src/components/checkout/checkout-section.tsx");
  assert.match(checkout, /\{tax && \(/);
  assert.match(checkout, /tax\.label/);
  assert.match(checkout, /tax\.amount\.formatted/);
  assert.ok(checkout.indexOf("checkout-tax") < checkout.indexOf("Total Amount"), "the tax line is above the total");
  const drawer = source("src/components/header/CartDrawer.tsx");
  assert.match(drawer, /\{check\.tax && \(/);
  assert.match(drawer, /check\.tax\.label/);
});

for (const [name, run] of checks) {
  run();
  console.log("ok - " + name);
}
console.log(checks.length + " checks passed");
