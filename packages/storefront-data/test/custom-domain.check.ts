/*
 * S7-B6 (D-118): checks for the storefront's custom domain rules that live in this package: the canonical origin of a store, that two stores on two hosts
 * never share a cache tag or an address, that no cookie of the storefront is set with a Domain attribute (a cookie like that would leak across hosts), and
 * that the preview cookie is host-only. From packages/storefront-data run:
 *
 *   npx tsx test/custom-domain.check.ts        (or: pnpm test, which runs every *.check.ts)
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { domainResolveTag, storeResolveTag } from "@markaz/platform-kit/cache-tags";
import { PREVIEW_COOKIE_NAME } from "@markaz/platform-kit/preview";
import { classifyHost, hostAllowsPreview } from "@markaz/platform-kit/tenancy-host";
import { canonicalStoreOrigin, feedOrigin } from "../src/domain/custom-domain";
import { buildStoreRobotsTxt, buildStoreSitemapXml, canonicalUrl } from "../src/domain/content";
import { clearedPreviewCookie, previewCookie } from "../src/preview";

// ---- canonical origin
assert.equal(canonicalStoreOrigin({ requestOrigin: "https://zara.markazify.com", customDomain: "shop.zara.pk" }), "https://shop.zara.pk", "a verified domain is canonical on the platform subdomain");
assert.equal(canonicalStoreOrigin({ requestOrigin: "https://shop.zara.pk", customDomain: "shop.zara.pk" }), "https://shop.zara.pk", "and on the domain itself");
assert.equal(canonicalStoreOrigin({ requestOrigin: "https://zara.markazify.com", customDomain: null }), "https://zara.markazify.com", "no domain: the host of the request");
assert.equal(canonicalStoreOrigin({ requestOrigin: "https://zara.markazify.com", customDomain: undefined }), "https://zara.markazify.com");
assert.equal(canonicalStoreOrigin({ requestOrigin: "http://zara.localhost:3000", customDomain: null }), "http://zara.localhost:3000", "local development keeps its scheme and port");
assert.equal(canonicalStoreOrigin({ requestOrigin: "https://zara.markazify.com", customDomain: "not a host" }), "https://zara.markazify.com", "a stored value that is not a host is ignored");
assert.equal(canonicalStoreOrigin({ requestOrigin: "javascript:alert(1)", customDomain: null }), null, "a bad request origin prints no address");
assert.equal(canonicalStoreOrigin({ requestOrigin: null, customDomain: "Shop.Zara.PK:8443" }), "https://shop.zara.pk", "the domain is cleaned: lower case, no port");

// ---- S7-B7: sitemap.xml and robots.txt of EACH host list only that host's own addresses (a sitemap may not list another host)
assert.equal(feedOrigin("https://zara.markazify.com"), "https://zara.markazify.com", "the platform subdomain feed is on the subdomain");
assert.equal(feedOrigin("https://shop.zara.pk"), "https://shop.zara.pk", "the custom host feed is on the custom host");
assert.equal(feedOrigin("javascript:alert(1)"), null, "a bad origin prints no address");
assert.equal(feedOrigin(null), null);
for (const [host, other] of [["https://zara.markazify.com", "shop.zara.pk"], ["https://shop.zara.pk", "zara.markazify.com"]] as const) {
  const own = feedOrigin(host);
  const sitemap = buildStoreSitemapXml({ origin: own, articles: [{ slug: "hello", publishedAt: null }], pages: [{ slug: "about", updatedAt: null }] });
  assert.ok(sitemap !== null && sitemap.includes("<loc>" + host + "/blog/hello</loc>") && sitemap.includes("<loc>" + host + "/pages/about</loc>"), host + ": its own addresses");
  assert.ok(sitemap !== null && !sitemap.includes(other), host + ": never the other host");
  const robots = buildStoreRobotsTxt({ origin: own, live: true });
  assert.ok(robots.includes("Sitemap: " + host + "/sitemap.xml"), host + ": robots.txt points to its own sitemap");
  assert.ok(!robots.includes(other));
}
assert.ok(buildStoreRobotsTxt({ origin: feedOrigin("https://shop.zara.pk"), live: false }).includes("Disallow: /"), "a store that is not live stays closed (noindex, CO-21)");
assert.ok(!buildStoreRobotsTxt({ origin: feedOrigin("https://shop.zara.pk"), live: false }).includes("Sitemap:"), "and lists no sitemap");
// the canonical TAG of a page still points to the verified custom domain, from either host
const origin = canonicalStoreOrigin({ requestOrigin: "https://zara.markazify.com", customDomain: "shop.zara.pk" });
assert.equal(canonicalUrl(origin, "/blog/hello"), "https://shop.zara.pk/blog/hello");

// ---- two stores on two hosts never share a cache entry or an address
const a = domainResolveTag("shop.zara.pk");
const b = domainResolveTag("shop.bilal.pk");
assert.notEqual(a, b);
assert.notEqual(a, storeResolveTag("zara"));
assert.notEqual(
  canonicalStoreOrigin({ requestOrigin: "https://zara.markazify.com", customDomain: "shop.zara.pk" }),
  canonicalStoreOrigin({ requestOrigin: "https://bilal.markazify.com", customDomain: "shop.bilal.pk" }),
);
assert.equal(classifyHost("shop.zara.pk", { rootDomain: "markazify.com", platformHostnames: "" }).host, "shop.zara.pk");

// ---- the preview cookie is host-only: no Domain attribute, and a custom host takes no preview
assert.ok(!/domain=/i.test(previewCookie("tok", 60, true)), "the preview cookie has no Domain attribute");
assert.ok(!/domain=/i.test(clearedPreviewCookie(true)));
assert.ok(previewCookie("tok", 60, false).startsWith(PREVIEW_COOKIE_NAME + "="));
assert.equal(hostAllowsPreview("custom"), false, "a custom host never reads a preview cookie or token");
assert.equal(hostAllowsPreview("subdomain"), true);

// ---- no cookie of the storefront or of this package is set with a Domain attribute (it would leak across store hosts)
const here = dirname(fileURLToPath(import.meta.url));
const storefront = join(here, "..", "..", "..", "apps", "storefront");
const roots = [join(here, "..", "src"), join(storefront, "app"), join(storefront, "lib"), join(storefront, "middleware.ts")];
function walk(path: string, out: string[]): string[] {
  const info = statSync(path);
  if (info.isFile()) return /\.(ts|tsx)$/.test(path) ? [...out, path] : out;
  let next = out;
  for (const name of readdirSync(path)) if (name !== "node_modules" && name !== ".next") next = walk(join(path, name), next);
  return next;
}
const sources = roots.flatMap((root) => walk(root, []));
assert.ok(sources.length > 20, "the scan found the sources");
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  assert.ok(!/Domain=/.test(text), file + " sets a cookie with a Domain attribute");
  assert.ok(!/cookies\(\)\.set\([^)]*domain/i.test(text), file + " sets a cookie with a domain option");
}

console.log("custom-domain checks passed");
