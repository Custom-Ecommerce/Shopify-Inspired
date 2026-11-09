/*
 * Checks for EP-09: the storefront really attaches the tags the backends purge, and favourites pass on a 429. No test
 * runner is needed. From packages/storefront-data run:
 *
 *   npx tsx test/cache-tags.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { isAllowedRevalidateTag, storeTags } from "@markaz/platform-kit/revalidate";
import { createBffRoutes } from "../src/bff/handlers";
import { OrderRejectedError } from "../src/transport/errors";
import { createMockTransport, mockProduct } from "../src/transport/mock";
import { createRemoteTransport } from "../src/transport/remote";
import type { OrderTransport } from "../src/transport/types";

const STORE = "65a000000000000000000011";

type Seen = { url: string; cache: RequestCache | undefined; next: { revalidate: number; tags: string[] } | undefined };

function transport(options: { previewToken?: string; clientIp?: string; status?: number; body?: unknown } = {}) {
  const seen: Seen[] = [];
  const client = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: STORE,
    previewToken: options.previewToken,
    clientIp: options.clientIp,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit & { next?: Seen["next"] }) => {
      seen.push({ url: String(input), cache: init?.cache, next: init?.next });
      return new Response(JSON.stringify(options.body ?? {}), { status: options.status ?? 200 });
    }) as typeof fetch,
  });
  return { client, seen };
}

const ignore = () => undefined;
const products = storeTags.products(STORE);
const staticTag = storeTags.static(STORE);

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

check("a product page is tagged with its slug, the product list, the store's settings and the store", async () => {
  const { client, seen } = transport();
  await client.getProduct("blue-shirt").catch(ignore);
  assert.deepEqual(seen[0]?.next, {
    revalidate: 600,
    tags: [storeTags.product(STORE, "blue-shirt"), storeTags.settings(STORE), products, staticTag],
  });
  assert.equal(seen[0]?.cache, undefined);
});

check("product lists are tagged with the product list and the store", async () => {
  const { client, seen } = transport();
  await client.getProducts().catch(ignore);
  await client.listProducts!({ page: 2 }).catch(ignore);
  for (const call of seen) assert.deepEqual(call.next, { revalidate: 600, tags: [products, staticTag] });
});

check("a search is kept only briefly", async () => {
  const { client, seen } = transport();
  await client.listProducts!({ q: "shirt" }).catch(ignore);
  assert.equal(seen[0]?.next?.revalidate, 60);
});

check("the category list is tagged with categories, products and the store", async () => {
  const { client, seen } = transport();
  await client.listCategories!().catch(ignore);
  assert.deepEqual(seen[0]?.next, { revalidate: 600, tags: [storeTags.categories(STORE), products, staticTag] });
});

check("every tag the storefront attaches is one the revalidate endpoint accepts", async () => {
  const { client, seen } = transport();
  await Promise.all([client.getProduct("blue-shirt"), client.getProducts(), client.listCategories!()].map((work) => work.catch(ignore)));
  const tags = seen.flatMap((call) => call.next?.tags ?? []);
  assert.ok(tags.length > 0);
  for (const tag of tags) assert.equal(isAllowedRevalidateTag(tag), true, tag);
});

check("a preview is never kept in the cache", async () => {
  const { client, seen } = transport({ previewToken: "a.b.c" });
  await Promise.all([client.getProduct("blue-shirt"), client.getProducts(), client.listCategories!()].map((work) => work.catch(ignore)));
  for (const call of seen) {
    assert.equal(call.cache, "no-store", call.url);
    assert.equal(call.next, undefined, call.url);
  }
});

check("favourites, quotes and orders are never kept in the cache", async () => {
  const { client, seen } = transport({ clientIp: "203.0.113.5" });
  await client.getProductsByIds(["p1"]).catch(ignore);
  await client.quoteCart({ lines: [] }).catch(ignore);
  await client.lookupOrder({ orderId: "ORD-1", phone: "03001234567" }).catch(ignore);
  assert.equal(seen.length, 3);
  for (const call of seen) {
    assert.equal(call.cache, "no-store", call.url);
    assert.equal(call.next, undefined, call.url);
  }
});

check("a 429 on favourites reaches the browser as a 429 with Retry-After", async () => {
  const { client } = transport({ status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many" }, retryAfterSeconds: 40 } });
  const routes = createBffRoutes({ lookupStore: async () => ({ outcome: "ok", transport: client as unknown as OrderTransport }) });
  const response = await routes.products(new Request("http://store.test/api/storefront/products?ids=abc"), { tenantKey: "alpha", clientIp: "203.0.113.5" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "40");
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "RATE_LIMITED");
});

check("the mock quotes a product with several variants and no choice as a line issue, as the backend does", async () => {
  const product = mockProduct({ id: "p1", slug: "p1", title: "Shirt", price: 1000 });
  const several = {
    ...product,
    variants: [product.variants[0]!, { ...product.variants[0]!, id: "v2", title: "Large" }],
  };
  const mock = createMockTransport({ products: [several] });
  const quote = await mock.quoteCart({ lines: [{ productId: "p1", qty: 1 }] });
  assert.equal(quote.lines[0]?.issue, "unknown_variant");
  assert.equal(quote.canCheckout, false);
  await assert.rejects(mock.submitOrder({ idempotencyKey: "cache-tags-0001", customer: { customerName: "Ali", phone: "+923001234567", address: "House 1, Street 2", city: "Karachi" }, lines: [{ productId: "p1", qty: 1 }] }), OrderRejectedError);
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
