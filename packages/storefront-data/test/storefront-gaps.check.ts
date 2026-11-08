/*
 * Checks for the part 11 storefront gaps: cart quantities, product search, order-lookup validation, the page loaders'
 * unavailable and not-found states, and the mock order lookup. No network and no Next.js. From packages/storefront-data run:
 *
 *   npx tsx test/storefront-gaps.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { MAX_LINE_QTY, setCartLineQty } from "../src/domain/cart";
import type { CartLine } from "../src/domain/cart";
import { searchProductSummaries } from "../src/domain/search";
import { validateOrderLookup } from "../src/domain/order-lookup";
import { loadProductPage } from "../src/server/product";
import { loadSearchPage } from "../src/server/search";
import { TransportUnavailableError } from "../src/transport/errors";
import { mockTransport } from "../src/transport/mock";
import type { StorefrontProductSummary, StorefrontTransport } from "../src/transport/types";

let passed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log("ok    " + name);
  } catch (error) {
    console.error("FAIL  " + name);
    throw error;
  }
}

function line(id: string, qty: number): CartLine {
  return { id, productId: id, slug: id, title: id, image: null, unitPrice: 100, qty };
}

function summary(id: string, title: string, category: string): StorefrontProductSummary {
  return {
    id,
    slug: id,
    title,
    currency: "PKR",
    price: 500,
    compareAtPrice: null,
    stockStatus: "in_stock",
    defaultVariantId: id + "_default",
    hasVariants: false,
    primaryImage: null,
    categories: [{ id: "c-" + category, slug: category, name: category }],
    avgRating: 0,
    reviewCount: 0,
  };
}

/** A transport whose reads fail the way a seller backend outage does. Writes are not used by these checks. */
const unreachableTransport: StorefrontTransport = {
  ...mockTransport,
  getProducts: async () => {
    throw new TransportUnavailableError("timeout");
  },
  getProduct: async () => {
    throw new TransportUnavailableError("timeout");
  },
};

async function main(): Promise<void> {
  await check("setCartLineQty sets one line and leaves the others alone", () => {
    const next = setCartLineQty([line("a", 2), line("b", 1)], "a", 5);
    assert.equal(next[0]?.qty, 5);
    assert.equal(next[1]?.qty, 1);
  });

  await check("setCartLineQty below 1 removes the line", () => {
    assert.deepEqual(
      setCartLineQty([line("a", 2), line("b", 1)], "a", 0).map((item) => item.id),
      ["b"],
    );
    assert.equal(setCartLineQty([line("a", 2)], "a", -3).length, 0);
  });

  await check("setCartLineQty caps at MAX_LINE_QTY and floors fractions", () => {
    assert.equal(setCartLineQty([line("a", 1)], "a", 1000)[0]?.qty, MAX_LINE_QTY);
    assert.equal(setCartLineQty([line("a", 1)], "a", 2.9)[0]?.qty, 2);
  });

  await check("setCartLineQty ignores a non-finite quantity and an unknown line", () => {
    const lines = [line("a", 2)];
    assert.equal(setCartLineQty(lines, "a", Number.NaN), lines);
    assert.deepEqual(setCartLineQty(lines, "missing", 4), lines);
  });

  const catalogue = [
    summary("p1", "Organic Basmati Rice 5kg", "Grocery"),
    summary("p2", "Classic Cotton Tee", "Apparel"),
    summary("p3", "Wireless Earbuds Pro", "Electronics"),
  ];

  await check("search matches title words in any case and any order", () => {
    assert.deepEqual(searchProductSummaries(catalogue, "  RICE ").map((p) => p.id), ["p1"]);
    assert.deepEqual(searchProductSummaries(catalogue, "basmati organic").map((p) => p.id), ["p1"]);
  });

  await check("search matches category names", () => {
    assert.deepEqual(searchProductSummaries(catalogue, "apparel").map((p) => p.id), ["p2"]);
  });

  await check("search requires every word, and an empty query matches nothing", () => {
    assert.deepEqual(searchProductSummaries(catalogue, "cotton tee").map((p) => p.id), ["p2"]);
    assert.deepEqual(searchProductSummaries(catalogue, "cotton electronics"), []);
    assert.deepEqual(searchProductSummaries(catalogue, "   "), []);
    assert.deepEqual(searchProductSummaries(catalogue, "sofa"), []);
  });

  await check("order lookup validation normalises the reference and the phone", () => {
    const result = validateOrderLookup({ orderId: " ord-abcd2345 ", phone: "0300 1234567" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.orderId, "ORD-ABCD2345");
      assert.equal(result.data.phone, "+923001234567");
    }
  });

  await check("order lookup validation reports each bad field once", () => {
    const result = validateOrderLookup({ orderId: "  ", phone: "12" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors.orderId, "Enter your order reference");
      assert.equal(result.errors.phone, "Enter the mobile number you ordered with");
    }
  });

  await check("product loader: a live product is ok", async () => {
    const outcome = await loadProductPage(mockTransport, "classic-cotton-tee");
    assert.equal(outcome.status, "ok");
    if (outcome.status === "ok") assert.equal(outcome.product.title, "Classic Cotton Tee");
  });

  await check("product loader: an unknown slug is not-found, not an error", async () => {
    assert.deepEqual(await loadProductPage(mockTransport, "no-such-product"), { status: "not-found" });
  });

  await check("product loader: an unreachable backend is unavailable with its reason", async () => {
    assert.deepEqual(await loadProductPage(unreachableTransport, "classic-cotton-tee"), {
      status: "unavailable",
      reason: "timeout",
    });
  });

  await check("product loader: an unexpected error propagates to the error boundary", async () => {
    const broken: StorefrontTransport = {
      ...mockTransport,
      getProduct: async () => {
        throw new Error("bug");
      },
    };
    await assert.rejects(() => loadProductPage(broken, "x"), /bug/);
  });

  await check("search loader: empty query is ok with no results and makes no request", async () => {
    const calls: string[] = [];
    const spy: StorefrontTransport = {
      ...mockTransport,
      getProducts: async () => {
        calls.push("getProducts");
        return [];
      },
    };
    assert.deepEqual(await loadSearchPage(spy, "  "), { status: "ok", results: [] });
    assert.deepEqual(calls, []);
  });

  await check("search loader: matches come back as cards; an outage is unavailable", async () => {
    const found = await loadSearchPage(mockTransport, "apparel");
    assert.equal(found.status, "ok");
    if (found.status === "ok") assert.deepEqual(found.results.map((p) => p.slug).sort(), ["classic-cotton-tee", "embroidered-lawn-kurta"]);
    assert.deepEqual(await loadSearchPage(unreachableTransport, "tee"), { status: "unavailable", reason: "timeout" });
  });

  await check("mock order lookup: found by id and local phone format, refused for another phone", async () => {
    const placed = await mockTransport.submitOrder({
      idempotencyKey: "gaps-check-key-0001",
      customer: { customerName: "Test Buyer", phone: "03001234567", address: "House 1, Street 2, Karachi" },
      lines: [{ productId: "prod_tee_001", qty: 2 }],
    });
    const found = await mockTransport.lookupOrder({ orderId: placed.orderId, phone: "0300 1234567" });
    assert.notEqual(found, null);
    assert.equal(found?.total, 2598);
    assert.equal(await mockTransport.lookupOrder({ orderId: placed.orderId, phone: "03009999999" }), null);
    assert.equal(await mockTransport.lookupOrder({ orderId: "ORD-0", phone: "03001234567" }), null);
  });

  console.log(passed + " checks passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
