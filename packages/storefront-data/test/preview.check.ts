/*
 * Checks for the storefront side of a seller's preview: the cookie, the token leaving the URL, the header on every call and
 * the blocked order. No test runner is needed. From packages/storefront-data run:
 *
 *   npx tsx test/preview.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { PREVIEW_CREDENTIAL_HEADER, PREVIEW_TOKEN_TTL_SECONDS } from "@markaz/platform-kit/preview";
import { toCheckoutFailure } from "../src/client/checkout-failure";
import {
  clearedPreviewCookie,
  confirmPreviewToken,
  previewCookie,
  previewSecondsLeft,
  withoutPreviewParam,
} from "../src/preview";
import { OrderRejectedError } from "../src/transport/errors";
import { createRemoteTransport, toOrderRejection } from "../src/transport/remote";
import { toProductCardVM } from "../src/view-models/product-card";
import type { StorefrontProductSummary } from "../src/transport/types";

const NOW = 1_800_000_000_000;

function tokenExpiringIn(seconds: number): string {
  const body = Buffer.from(JSON.stringify({ exp: NOW / 1000 + seconds })).toString("base64url");
  return "head." + body + ".signature";
}

// The cookie: host-only, httpOnly, Lax, Secure only when asked, and no longer than the token.
{
  const cookie = previewCookie("a.b.c", 600, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=600/);
  assert.doesNotMatch(cookie, /Domain/i);
  assert.doesNotMatch(previewCookie("a.b.c", 600, false), /Secure/);
  assert.match(clearedPreviewCookie(false), /Max-Age=0/);
  assert.doesNotMatch(clearedPreviewCookie(true), /Domain/i);

  assert.equal(previewSecondsLeft(tokenExpiringIn(600), NOW), 600);
  assert.equal(previewSecondsLeft(tokenExpiringIn(-5), NOW), 0);
  assert.equal(previewSecondsLeft(tokenExpiringIn(PREVIEW_TOKEN_TTL_SECONDS * 9), NOW), PREVIEW_TOKEN_TTL_SECONDS);
  assert.equal(previewSecondsLeft("not.a-token.at-all", NOW), 0);
}

// The token leaves the URL, the rest stays, and the result can never point at another host.
{
  assert.equal(withoutPreviewParam("/", "?preview=a.b.c"), "/");
  assert.equal(withoutPreviewParam("/products/x", "?a=1&preview=a.b.c&b=2"), "/products/x?a=1&b=2");
  assert.equal(withoutPreviewParam("//evil.test/path", "?preview=a.b.c"), "/evil.test/path");
}

// Only a clear yes from the backend counts, and the token travels in a header, never in the URL.
async function checkConfirm(): Promise<void> {
  const seen: { url: string; header: string | null }[] = [];
  const answering = (status: number, body: unknown): typeof fetch =>
    async (input, init) => {
      seen.push({ url: String(input), header: new Headers(init?.headers).get(PREVIEW_CREDENTIAL_HEADER) });
      return new Response(JSON.stringify(body), { status });
    };
  const input = { baseUrl: "http://seller.test/", storeKey: "alpha-store", token: "a.b.c" };

  assert.equal(await confirmPreviewToken({ ...input, fetchImpl: answering(200, { data: {}, preview: true }) }), true);
  assert.equal(await confirmPreviewToken({ ...input, fetchImpl: answering(200, { data: {} }) }), false);
  assert.equal(await confirmPreviewToken({ ...input, fetchImpl: answering(503, { preview: true }) }), false);
  assert.equal(
    await confirmPreviewToken({
      ...input,
      fetchImpl: async () => {
        throw new Error("down");
      },
    }),
    false,
  );
  assert.equal(seen[0]?.url, "http://seller.test/api/storefront/v1/stores/by-key/alpha-store?by=slug");
  assert.equal(seen[0]?.header, "a.b.c");
}

// Every call of a preview transport carries the header, and a live transport carries none.
async function checkTransport(): Promise<void> {
  const calls: { url: string; header: string | null; cache: RequestCache | undefined }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), header: new Headers(init?.headers).get(PREVIEW_CREDENTIAL_HEADER), cache: init?.cache });
    return new Response(JSON.stringify({ data: [], page: 1, totalPages: 0, totalDocs: 0, limit: 24 }), { status: 200 });
  };
  const base = { baseUrl: "http://seller.test", storeId: "65a000000000000000000011", fetchImpl };

  const preview = createRemoteTransport({ ...base, previewToken: "a.b.c" });
  await preview.getProducts();
  await preview.listCategories();
  await preview.listProducts?.({ q: "lawn" });
  await preview.getProduct("x").catch(() => undefined);
  await preview.quoteCart({ lines: [] }).catch(() => undefined);
  await preview
    .submitOrder({ idempotencyKey: "key-00001", customer: { customerName: "A", phone: "1", address: "x", city: "K" }, lines: [] })
    .catch(() => undefined);

  assert.equal(calls.length, 6);
  for (const call of calls) {
    assert.equal(call.header, "a.b.c", call.url);
    assert.equal(call.cache, "no-store", call.url);
    assert.ok(!call.url.includes("a.b.c"), "the token must not be in a URL");
  }

  calls.length = 0;
  await createRemoteTransport(base).getProducts();
  assert.equal(calls[0]?.header, null);
}

// A blocked order reaches the checkout as the invalid_request a theme already shows.
{
  const rejection = toOrderRejection({ error: { code: "PREVIEW_ORDER_BLOCKED", message: "This is a preview." } });
  assert.deepEqual(rejection, { code: "invalid_request", message: "This is a preview." });
  assert.ok(rejection);
  assert.deepEqual(toCheckoutFailure(new OrderRejectedError(rejection), []), { kind: "invalid_request", message: "This is a preview." });
}

// The view-model: a label only when the backend sent one.
{
  const dto: StorefrontProductSummary = {
    id: "p1",
    slug: "p1",
    title: "P1",
    currency: "PKR",
    price: 1000,
    compareAtPrice: null,
    stockStatus: "in_stock",
    defaultVariantId: "v1",
    hasVariants: false,
    primaryImage: null,
    categories: [],
    avgRating: 0,
    reviewCount: 0,
  };
  assert.equal(toProductCardVM(dto).previewLabel, null);
  assert.equal(toProductCardVM({ ...dto, previewLabel: "Draft" }).previewLabel, "Draft");
  assert.equal(toProductCardVM({ ...dto, previewLabel: "Sample product" }).previewLabel, "Sample product");
}

async function main(): Promise<void> {
  await checkConfirm();
  await checkTransport();
  console.log("preview checks passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
