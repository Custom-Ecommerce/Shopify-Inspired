import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REVALIDATE_MAX_TAGS,
  buildRevalidateRequest,
  isAllowedRevalidateTag,
  secretsMatch,
  storeResolveTag,
  storeTags,
  validateRevalidateTags,
} from "./index";

const STORE_ID = "64b7f0c2a1d3e4f5a6b7c8d9";
const PRODUCT_ID = "64b7f0c2a1d3e4f5a6b7c8da";

describe("allowed revalidation tags", () => {
  it("accepts the global and canonical store-scoped tags", () => {
    for (const tag of [
      "categories",
      "products",
      "stores",
      "themes-catalog",
      storeTags.static(STORE_ID),
      storeTags.categories(STORE_ID),
      storeTags.products(STORE_ID),
      storeTags.product(STORE_ID, PRODUCT_ID),
      storeResolveTag("molahassan"),
    ]) {
      assert.equal(isAllowedRevalidateTag(tag), true, tag);
    }
  });

  it("accepts the legacy tags the backends currently emit", () => {
    assert.equal(isAllowedRevalidateTag("stores-molahassan"), true);
    assert.equal(isAllowedRevalidateTag(`products-${STORE_ID}`), true);
  });

  it("rejects unknown shapes, injected separators, and oversized tags", () => {
    for (const tag of [
      "",
      "stores-",
      "store:abc:layout",
      `store:${STORE_ID}:static;rm`,
      "../etc/passwd",
      "products ",
      `store:${STORE_ID}:${"x".repeat(250)}`,
    ]) {
      assert.equal(isAllowedRevalidateTag(tag), false, tag);
    }
  });

  it("rejects non-string values", () => {
    assert.equal(isAllowedRevalidateTag(undefined), false);
    assert.equal(isAllowedRevalidateTag(["products"]), false);
  });
});

describe("validateRevalidateTags", () => {
  it("de-duplicates valid tags", () => {
    const result = validateRevalidateTags(["products", "products", "categories"]);
    assert.deepEqual(result, { ok: true, tags: ["products", "categories"] });
  });

  it("rejects a missing, empty, or non-array input", () => {
    assert.equal(validateRevalidateTags(undefined).ok, false);
    assert.equal(validateRevalidateTags([]).ok, false);
    assert.equal(validateRevalidateTags("products").ok, false);
  });

  it("rejects more than the maximum tag count", () => {
    const tags = Array.from({ length: REVALIDATE_MAX_TAGS + 1 }, () => "products");
    const result = validateRevalidateTags(tags);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "TOO_MANY_TAGS");
  });

  it("fails the whole batch and lists the invalid entries", () => {
    const result = validateRevalidateTags(["products", "bogus", 7]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "INVALID_TAG");
      assert.deepEqual(result.invalidTags, ["bogus", "number"]);
    }
  });
});

describe("buildRevalidateRequest", () => {
  const storefrontUrl = "https://storefront.markazify.pk/";
  const secret = "s3cret-value";

  it("posts a JSON body with the secret in the header, never in the URL", () => {
    const result = buildRevalidateRequest({ storefrontUrl, secret, tags: ["products"] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const { url, init } = result.request;
    assert.equal(url, "https://storefront.markazify.pk/api/revalidate");
    assert.ok(!url.includes(secret), "secret must not appear in the URL");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-revalidate-secret"], secret);
    assert.deepEqual(JSON.parse(init.body), { tags: ["products"] });
  });

  it("keeps a path prefix on the storefront URL and drops trailing slashes", () => {
    const result = buildRevalidateRequest({
      storefrontUrl: "https://example.com/shop///",
      secret,
      tags: ["categories"],
    });
    assert.equal(result.ok && result.request.url, "https://example.com/shop/api/revalidate");
  });

  it("refuses to build without a secret or URL", () => {
    assert.deepEqual(buildRevalidateRequest({ storefrontUrl: "", secret, tags: ["products"] }), {
      ok: false,
      reason: "MISSING_CONFIG",
    });
    assert.deepEqual(buildRevalidateRequest({ storefrontUrl, secret: "", tags: ["products"] }), {
      ok: false,
      reason: "MISSING_CONFIG",
    });
  });

  it("refuses non-http schemes and unparseable URLs", () => {
    assert.equal(buildRevalidateRequest({ storefrontUrl: "ftp://x.pk", secret, tags: ["products"] }).ok, false);
    assert.equal(buildRevalidateRequest({ storefrontUrl: "not a url", secret, tags: ["products"] }).ok, false);
  });

  it("refuses to send a disallowed tag", () => {
    const result = buildRevalidateRequest({ storefrontUrl, secret, tags: ["store:x:layout"] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "INVALID_TAG");
  });
});

describe("secretsMatch", () => {
  it("matches an identical secret", () => {
    assert.equal(secretsMatch("abc123", "abc123"), true);
  });

  it("rejects a different secret, including a prefix of it", () => {
    assert.equal(secretsMatch("abc12", "abc123"), false);
    assert.equal(secretsMatch("abc1234", "abc123"), false);
  });

  it("rejects when either side is missing or empty", () => {
    assert.equal(secretsMatch(null, "abc123"), false);
    assert.equal(secretsMatch("abc123", undefined), false);
    assert.equal(secretsMatch("", ""), false);
  });
});
