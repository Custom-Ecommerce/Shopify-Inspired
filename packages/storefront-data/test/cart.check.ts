/*
 * Checks for EP-03.US06 and the confirmation read: the cart is kept per store, flags stock, and tells the shopper what changed.
 * No test runner is needed. From packages/storefront-data run:
 *
 *   npx tsx test/cart.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { cartStorageKey, createStorefrontCartStore, DEMO_CART_KEY } from "../src/client/cart-store";
import { MAX_CART_LINES } from "../src/domain/cart";
import { toMoney } from "../src/domain/money";
import { DEFAULT_MOCK_PRODUCTS, createMockTransport, mockProduct } from "../src/transport/mock";
import { createRemoteTransport } from "../src/transport/remote";
import type { OrderTransport, StorefrontProductDetail } from "../src/transport/types";
import { cartLineNotice, checkoutBlockReason, compareCartToQuote, toCartQuoteVM } from "../src/view-models/cart-quote";
import type { CartQuoteLineVM } from "../src/view-models/cart-quote";
import { initialSelection, toProductDetailVM, toVariantSelectionVM } from "../src/view-models/product-detail";

class MemoryStorage {
  values = new Map<string, string>();
  throwing = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.throwing) throw new Error("quota");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

let storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { get: () => storage, configurable: true });

const product = (n: number) => ({ id: "p" + n, variantId: "v" + n, variantTitle: null, slug: "p" + n, title: "Item " + n, image: null, unitPrice: 1000 });

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};
const fresh = () => {
  storage = new MemoryStorage();
};

const reopen = async (key: string) => {
  const store = createStorefrontCartStore(key);
  await store.persist.rehydrate();
  return store;
};

check("the key names the store, and preview and each demo are kept apart", () => {
  assert.equal(cartStorageKey({ storeKey: "store-a" }), "markaz-cart:store-a");
  assert.equal(cartStorageKey({ storeKey: "store-b" }), "markaz-cart:store-b");
  assert.equal(cartStorageKey({ storeKey: "store-a", preview: true }), "markaz-cart:preview:store-a");
  assert.equal(cartStorageKey({ demoScope: "stiletto" }), DEMO_CART_KEY + ":stiletto");
  assert.notEqual(cartStorageKey({ demoScope: "stiletto" }), cartStorageKey({ demoScope: "mustafa" }));
  assert.equal(cartStorageKey({}), DEMO_CART_KEY);
});

check("a cart survives a reload and a browser restart", async () => {
  fresh();
  const first = await reopen("markaz-cart:store-a");
  first.getState().addLine(product(1), 2);
  first.getState().setDiscountCode("EID10");
  const second = await reopen("markaz-cart:store-a");
  assert.equal(second.getState().lines.length, 1);
  assert.equal(second.getState().lines[0]?.qty, 2);
  assert.equal(second.getState().discountCode, "EID10");
});

check("the stored cart is versioned", async () => {
  fresh();
  const store = await reopen("markaz-cart:store-a");
  store.getState().addLine(product(1), 1);
  assert.equal(JSON.parse(storage.values.get("markaz-cart:store-a") as string).version, 2);
});

check("an older version of the cart is not read as this one", async () => {
  fresh();
  storage.values.set("markaz-cart:store-a", JSON.stringify({ state: { lines: [{ id: "x" }] }, version: 1 }));
  assert.deepEqual((await reopen("markaz-cart:store-a")).getState().lines, []);
});

check("two stores never see each other's cart", async () => {
  fresh();
  (await reopen("markaz-cart:store-a")).getState().addLine(product(1), 1);
  assert.deepEqual((await reopen("markaz-cart:store-b")).getState().lines, []);
});

check("a preview's cart never reaches the live cart, or the other way round", async () => {
  fresh();
  (await reopen(cartStorageKey({ storeKey: "store-a", preview: true }))).getState().addLine(product(1), 1);
  assert.deepEqual((await reopen(cartStorageKey({ storeKey: "store-a" }))).getState().lines, []);
  (await reopen(cartStorageKey({ storeKey: "store-a" }))).getState().addLine(product(2), 1);
  assert.equal((await reopen(cartStorageKey({ storeKey: "store-a", preview: true }))).getState().lines[0]?.id, "v1");
});

check("a successful order clears the cart and the code from storage too", async () => {
  fresh();
  const store = await reopen("markaz-cart:store-a");
  store.getState().addLine(product(1), 1);
  store.getState().setDiscountCode("EID10");
  store.getState().clearLines();
  const again = await reopen("markaz-cart:store-a");
  assert.deepEqual(again.getState().lines, []);
  assert.equal(again.getState().discountCode, null);
});

check("the cart stops at its limit, and adding to a line already there still works", async () => {
  fresh();
  const store = await reopen("markaz-cart:store-a");
  for (let n = 0; n < MAX_CART_LINES + 5; n += 1) store.getState().addLine(product(n), 1);
  assert.equal(store.getState().lines.length, MAX_CART_LINES);
  store.getState().addLine(product(0), 1);
  assert.equal(store.getState().lines[0]?.qty, 2);
});

check("an oversized stored cart is cut to the limit when read", async () => {
  fresh();
  const lines = Array.from({ length: MAX_CART_LINES + 20 }, (_, n) => ({ id: "v" + n, productId: "p" + n, variantId: "v" + n, variantTitle: null, slug: "s", title: "t", image: null, unitPrice: 1, qty: 1 }));
  storage.values.set("markaz-cart:store-a", JSON.stringify({ state: { lines }, version: 2 }));
  assert.equal((await reopen("markaz-cart:store-a")).getState().lines.length, MAX_CART_LINES);
});

check("a corrupt stored cart is dropped, not fatal", async () => {
  fresh();
  storage.values.set("markaz-cart:store-a", JSON.stringify({ state: { lines: [{ nonsense: true }, 42], discountCode: 9 }, version: 2 }));
  const store = await reopen("markaz-cart:store-a");
  assert.deepEqual(store.getState().lines, []);
  assert.equal(store.getState().discountCode, null);
});

check("a full or blocked browser store does not break the cart", async () => {
  fresh();
  storage.throwing = true;
  const store = await reopen("markaz-cart:store-a");
  store.getState().addLine(product(1), 1);
  assert.equal(store.getState().lines.length, 1);
});

const line = (fields: Partial<CartQuoteLineVM>): CartQuoteLineVM => ({ productId: "p1", variantId: "v1", issue: null, availableQty: 10, unitPrice: toMoney(1000), lineTotal: toMoney(1000), ...fields });
const quoteOf = (lines: CartQuoteLineVM[]) => ({ lines, subtotal: toMoney(0), deliveryCharges: toMoney(0), discount: toMoney(0), total: toMoney(0), canCheckout: true, discountCode: null, discountError: null });
const cartLine = { id: "v1", variantId: "v1", title: "Blue shirt", unitPrice: toMoney(1000) };

check("a line says Only N left at 5 or fewer, and nothing above that", () => {
  assert.deepEqual(cartLineNotice(line({ availableQty: 5 })), { tone: "warning", text: "Only 5 left" });
  assert.deepEqual(cartLineNotice(line({ availableQty: 1 })), { tone: "warning", text: "Only 1 left" });
  assert.equal(cartLineNotice(line({ availableQty: 6 })), null);
  assert.equal(cartLineNotice(line({ availableQty: null })), null);
});

check("a line that cannot be bought is flagged with what is left", () => {
  assert.deepEqual(cartLineNotice(line({ issue: "insufficient_stock", availableQty: 2 })), { tone: "blocked", text: "Only 2 available. Lower the quantity." });
  assert.deepEqual(cartLineNotice(line({ issue: "out_of_stock", availableQty: 0 })), { tone: "blocked", text: "Sold out" });
  assert.deepEqual(cartLineNotice(line({ issue: "unknown_product", availableQty: null })), { tone: "blocked", text: "No longer available" });
});

check("the checkout button says why", () => {
  assert.equal(checkoutBlockReason([cartLine], quoteOf([line({})])), null);
  assert.equal(checkoutBlockReason([cartLine], quoteOf([line({ issue: "out_of_stock" })])), "Blue shirt is sold out. Remove it to continue.");
  assert.equal(checkoutBlockReason([cartLine], quoteOf([line({ issue: "insufficient_stock", availableQty: 2 })])), "Only 2 of Blue shirt left. Lower the quantity to continue.");
  assert.equal(checkoutBlockReason([cartLine], quoteOf([line({ issue: "unknown_product" })])), "Blue shirt is no longer available. Remove it to continue.");
});

check("a changed price and a removed product are told, with the new price to apply", () => {
  const changed = compareCartToQuote([cartLine], quoteOf([line({ unitPrice: toMoney(1200) })]));
  assert.deepEqual(changed.prices, [{ lineId: "v1", unitPrice: 1200 }]);
  assert.match(changed.notices[0] as string, /^The price of Blue shirt changed from .*1,000.* to .*1,200.*\.$/);

  const removed = compareCartToQuote([cartLine], quoteOf([line({ issue: "unknown_product", unitPrice: null })]));
  assert.deepEqual(removed, { prices: [], notices: ["Blue shirt is no longer available."] });

  assert.deepEqual(compareCartToQuote([cartLine], quoteOf([line({})])), { prices: [], notices: [] });
});

check("the new price is kept, so the same change is not told twice", async () => {
  fresh();
  const store = await reopen("markaz-cart:store-a");
  store.getState().addLine(product(1), 2);
  store.getState().applyPrices([{ lineId: "v1", unitPrice: 1200 }]);
  assert.equal(store.getState().lines[0]?.unitPrice, 1200);
  assert.equal((await reopen("markaz-cart:store-a")).getState().lines[0]?.unitPrice, 1200);
});

check("the quote's price reaches the view model", () => {
  const vm = toCartQuoteVM({ lines: [{ productId: "p", variantId: "v", title: "T", variantTitle: null, unitPrice: 900, qty: 1, lineTotal: 900, issue: null, availableQty: 3 }], subtotal: 900, deliveryCharges: 0, discount: 0, total: 900, canCheckout: true, discountCode: null, discountError: null });
  assert.equal(vm.lines[0]?.unitPrice?.amount, 900);
});

check("the product page says Only N left for the chosen variant", () => {
  const base = DEFAULT_MOCK_PRODUCTS.find((item) => item.variants.length === 1) as StorefrontProductDetail;
  const low = { ...base, variants: [{ ...base.variants[0]!, availability: "low_stock" as const, onlyLeft: 3 }] };
  const detail = toProductDetailVM(low);
  assert.equal(toVariantSelectionVM(detail, initialSelection(detail)).stock.label, "Only 3 left");
  const plenty = toProductDetailVM(base);
  assert.notEqual(toVariantSelectionVM(plenty, initialSelection(plenty)).stock.label, "Only 3 left");
});

const SITE = "http://alpha.localhost:3000";
const send = (body: unknown) =>
  new Request(SITE + "/api/storefront/orders/confirmation", {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-host": "alpha.localhost:3000" },
    body: JSON.stringify(body),
  });

check("the BFF reads an order with its token, and a bad one is the generic 404", async () => {
  const transport = { confirmOrder: async (input: { token: string }) => (input.token === "good" ? { orderId: "ORD-1" } : null) } as unknown as OrderTransport;
  const routes = createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport }) });
  const context = { tenantKey: "alpha", clientIp: null };
  const ok = await routes.confirmation(send({ orderNumber: "ORD-1", token: "good" }), context);
  assert.equal(ok.status, 200);
  const bad = await routes.confirmation(send({ orderNumber: "ORD-1", token: "bad" }), context);
  assert.equal(bad.status, 404);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "ORDER_NOT_FOUND");
  assert.equal((await routes.confirmation(send({ orderNumber: "ORD-1" }), context)).status, 400);
});

check("the transport reads the token answer, and treats a generic 404 as nothing found", async () => {
  const bodies: unknown[] = [];
  const client = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: { code: "ORDER_NOT_FOUND" } }), { status: 404 });
    }) as typeof fetch,
  });
  assert.equal(await client.confirmOrder({ orderNumber: "ORD-1", token: "t" }), null);
  assert.deepEqual(bodies[0], { orderNumber: "ORD-1", token: "t" });
});

check("a demo order can be read back with its token, and not without it", async () => {
  const mock = createMockTransport({ products: [mockProduct({ id: "p1", slug: "p1", title: "Shirt", price: 1000 })] });
  const placed = await mock.submitOrder({ idempotencyKey: "cart-check-0001", customer: { customerName: "Ali", phone: "+923001234567", address: "House 1, Street 2", city: "Karachi" }, lines: [{ productId: "p1", qty: 1 }] });
  assert.equal((await mock.confirmOrder({ orderNumber: placed.orderId, token: placed.accessToken as string }))?.orderId, placed.orderId);
  assert.equal(await mock.confirmOrder({ orderNumber: placed.orderId, token: "wrong" }), null);
});

void (async () => {
  for (const [name, run] of checks) {
    await run();
    console.log("ok - " + name);
  }
  console.log(checks.length + " checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
