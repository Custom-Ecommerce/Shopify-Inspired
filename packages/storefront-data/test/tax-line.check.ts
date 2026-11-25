/*
 * Checks for Sprint 8 (S8-B1, D-118): the store's tax line. The quote and the order carry the tax the SERVER worked out; the view only names it ("Tax" for an exclusive
 * tax, "Tax (included)" for an inclusive one, the store's own label) and shows no line at all when there is no tax. No test runner is needed. From
 * packages/storefront-data run:
 *
 *   npx tsx test/tax-line.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { createMockTransport } from "../src/transport/mock";
import { createRemoteTransport } from "../src/transport/remote";
import { WireCartQuote, WireOrder, WireOrderLookup } from "../src/transport/wire";
import type { CartQuoteInput, OrderTransport } from "../src/transport/types";
import { toCartQuoteVM } from "../src/view-models/cart-quote";
import { DEFAULT_TAX_LABEL, taxLineLabel, toTaxLine } from "../src/view-models/tax-line";

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

const line = { productId: "p", variantId: "v", title: "T", variantTitle: null, unitPrice: 1000, qty: 2, lineTotal: 2000, issue: null, availableQty: 5 };
const QUOTE = { lines: [line], subtotal: 2000, deliveryCharges: 250, discount: 0, canCheckout: true, discountCode: null, discountError: null };

check("the label: the store's own name, 'Tax' by default, '(included)' for an inclusive tax", () => {
  assert.equal(DEFAULT_TAX_LABEL, "Tax");
  assert.equal(taxLineLabel("Tax", "exclusive"), "Tax");
  assert.equal(taxLineLabel("Tax", "inclusive"), "Tax (included)");
  assert.equal(taxLineLabel("GST", "inclusive"), "GST (included)");
  assert.equal(taxLineLabel("GST", "exclusive"), "GST");
  assert.equal(taxLineLabel(null, "exclusive"), "Tax");
  assert.equal(taxLineLabel("  ", "inclusive"), "Tax (included)");
  assert.equal(taxLineLabel(undefined, undefined), "Tax");
});

check("a tax line exists only when the tax is more than 0", () => {
  assert.equal(toTaxLine(null), null);
  assert.equal(toTaxLine(undefined), null);
  assert.equal(toTaxLine({}), null, "an old server or an old order");
  assert.equal(toTaxLine({ taxAmount: 0, taxMode: "exclusive", taxLabel: "Tax" }), null);
  assert.equal(toTaxLine({ taxAmount: -5, taxMode: "exclusive" }), null);
  assert.equal(toTaxLine({ taxAmount: Number.NaN }), null);
});

check("an exclusive tax reads 'Tax' and is added to the total; an inclusive tax reads 'Tax (included)'", () => {
  const exclusive = toTaxLine({ taxAmount: 340, taxMode: "exclusive", taxLabel: "Tax" });
  assert.equal(exclusive?.label, "Tax");
  assert.equal(exclusive?.included, false);
  assert.equal(exclusive?.amount.amount, 340);
  assert.match(exclusive?.amount.formatted ?? "", /340/);
  const inclusive = toTaxLine({ taxAmount: 306, taxMode: "inclusive", taxLabel: "Tax" });
  assert.equal(inclusive?.label, "Tax (included)");
  assert.equal(inclusive?.included, true);
  const gst = toTaxLine({ taxAmount: 306, taxMode: "inclusive", taxLabel: "GST" });
  assert.equal(gst?.label, "GST (included)");
  assert.equal(toTaxLine({ taxAmount: 10, taxMode: null })?.mode, "exclusive", "an amount with no mode is shown as it is, as an added tax");
});

check("the cart quote view carries the tax line; a quote with tax off or from an old server has none", () => {
  const taxed = toCartQuoteVM({ ...QUOTE, taxAmount: 340, taxMode: "exclusive", taxLabel: "Tax", total: 2590 });
  assert.equal(taxed.tax?.label, "Tax");
  assert.equal(taxed.tax?.amount.amount, 340);
  assert.equal(taxed.total.amount, 2590, "the view shows the server's total, it never adds the tax itself");
  const inclusive = toCartQuoteVM({ ...QUOTE, taxAmount: 306, taxMode: "inclusive", taxLabel: "Tax", total: 2250 });
  assert.equal(inclusive.tax?.label, "Tax (included)");
  assert.equal(inclusive.total.amount, 2250, "an inclusive tax does not change the total");
  const off = toCartQuoteVM({ ...QUOTE, taxAmount: 0, total: 2250 });
  assert.equal(off.tax, null);
  const old = toCartQuoteVM({ ...QUOTE, total: 2250 } as never);
  assert.equal(old.tax, null, "a quote with no tax fields at all");
});

check("the wire schemas keep the tax fields (they would be stripped if the schema did not name them) and default an old answer to tax 0", () => {
  const quote = WireCartQuote.parse({ ...QUOTE, taxAmount: 340, taxMode: "exclusive", taxLabel: "GST", total: 2590 });
  assert.equal(quote.taxAmount, 340);
  assert.equal(quote.taxMode, "exclusive");
  assert.equal(quote.taxLabel, "GST");
  const old = WireCartQuote.parse({ ...QUOTE, total: 2250 });
  assert.equal(old.taxAmount, 0);
  assert.equal(old.taxMode, undefined);
  const order = {
    orderId: "ORD-1", status: "pending", paymentMethod: "cod", subtotal: 3000, deliveryCharges: 250, total: 3760, createdAt: "2026-11-22T10:00:00.000Z",
    customerName: "Sara", phone: "+923001234567", city: null, address: "x", items: [], updatedAt: "2026-11-22T10:00:00.000Z",
  };
  const taxed = WireOrder.parse({ ...order, taxAmount: 510, taxMode: "exclusive", taxLabel: "GST" });
  assert.deepEqual([taxed.taxAmount, taxed.taxMode, taxed.taxLabel], [510, "exclusive", "GST"]);
  const oldOrder = WireOrderLookup.parse({ data: order }).data;
  assert.deepEqual([oldOrder.taxAmount, oldOrder.taxMode, oldOrder.taxLabel], [0, null, null]);
  assert.equal(WireOrder.safeParse({ ...order, taxAmount: 1.5 }).success, false);
  assert.equal(WireOrder.safeParse({ ...order, taxMode: "both" }).success, false);
});

check("the remote transport hands the server's quote and order tax through untouched", async () => {
  const responses: Record<string, unknown> = {
    "/cart/quote": { data: { ...QUOTE, taxAmount: 340, taxMode: "exclusive", taxLabel: "GST", total: 2590 } },
    "/orders/lookup": {
      data: {
        orderId: "ORD-1", status: "pending", paymentMethod: "card", subtotal: 3000, deliveryCharges: 250, total: 3250, createdAt: "2026-11-22T10:00:00.000Z",
        taxAmount: 436, taxMode: "inclusive", taxLabel: "Tax", customerName: "Sara", phone: "+923001234567", city: null, address: "x", items: [], updatedAt: "2026-11-22T10:00:00.000Z",
      },
    },
  };
  const client = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const path = Object.keys(responses).find((key) => String(input).endsWith(key));
      return new Response(JSON.stringify(path ? responses[path] : {}), { status: path ? 200 : 404 });
    }) as typeof fetch,
  });
  const quote = await client.quoteCart({ lines: [{ productId: "p", qty: 2 }] });
  assert.equal(quote.taxAmount, 340);
  assert.equal(quote.taxLabel, "GST");
  const order = await client.lookupOrder({ orderId: "ORD-1", phone: "0300 1234567" });
  assert.equal(order?.taxAmount, 436);
  assert.equal(order?.taxMode, "inclusive");
});

check("the BFF passes the quote's tax fields through to the browser", async () => {
  const quote = { ...QUOTE, taxAmount: 340, taxMode: "exclusive" as const, taxLabel: "GST", total: 2590 };
  const transport = {
    quoteCart: async (_input: CartQuoteInput) => quote,
    submitOrder: async () => ({ orderId: "ORD-1", total: 1 }),
    trackOrder: async () => null,
    lookupOrder: async () => null,
    confirmOrder: async () => null,
  } as unknown as OrderTransport;
  const routes = createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport }) });
  const SITE = "http://mustafa.localhost:3000";
  const response = await routes.quote(
    new Request(SITE + "/api/storefront/cart/quote", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "mustafa.localhost:3000" },
      body: JSON.stringify({ lines: [{ productId: "65a0000000000000000000aa", qty: 2 }] }),
    }),
    { tenantKey: "mustafa", clientIp: null },
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: typeof quote };
  assert.equal(body.data.taxAmount, 340);
  assert.equal(body.data.taxLabel, "GST");
  assert.equal(body.data.total, 2590);
});

check("the mock transport (a demo store) has no tax: taxAmount 0 on the quote", async () => {
  const mock = createMockTransport({ products: [] });
  const quote = await mock.quoteCart({ lines: [] });
  assert.equal(quote.taxAmount, 0);
  assert.equal(toCartQuoteVM(quote).tax, null);
});

void (async () => {
  for (const [name, run] of checks) {
    await run();
    console.log("ok - " + name);
  }
  console.log(checks.length + " checks passed");
})();
