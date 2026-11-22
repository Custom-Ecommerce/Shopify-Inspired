import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyHost,
  cleanRequestHost,
  customDomainKey,
  customDomainRedirect,
  forwardedHostTrusted,
  hostAllowsPreview,
  requestHostFromHeaders,
  requestHostWithPort,
  subdomainLabel,
} from "./tenancy-host";
import { domainResolveTag, isAllowedRevalidateTag, storeResolveTag } from "./revalidate/tags";

const SETTINGS = { rootDomain: "markazify.com", platformHostnames: "127.0.0.1,[::1],www.markazify.com" };
const LOCAL = { rootDomain: "localhost:3000", platformHostnames: "" };

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe("cleanRequestHost", () => {
  it("lower-cases, drops the port and a trailing dot, and keeps the first value of a joined header", () => {
    assert.equal(cleanRequestHost("Shop.Zara.PK:8443"), "shop.zara.pk");
    assert.equal(cleanRequestHost("shop.zara.pk."), "shop.zara.pk");
    assert.equal(cleanRequestHost("shop.zara.pk, evil.example.com"), "shop.zara.pk");
  });
  it("refuses anything that is not a host name", () => {
    for (const bad of ["", " ", null, undefined, "[::1]", "a b.com", "a/b.com", "a@b.com", "-a.com", "a..com", "x".repeat(64) + ".com", "http://a.com"]) {
      assert.equal(cleanRequestHost(bad as string | null | undefined), null, String(bad));
    }
  });
});

describe("customDomainKey", () => {
  it("a host with a dot is a domain key, cleaned; a slug, a handle and anything else is not", () => {
    assert.equal(customDomainKey("Shop.Zara.PK:443"), "shop.zara.pk");
    assert.equal(customDomainKey("zara"), null);
    assert.equal(customDomainKey("zara-store-1"), null);
    assert.equal(customDomainKey("a b.com"), null);
    assert.equal(customDomainKey(null), null);
    assert.equal(customDomainKey("[::1]"), null);
  });
});

describe("classifyHost", () => {
  it("the root domain and the platform hostnames are the platform, with or without a port", () => {
    assert.deepEqual(classifyHost("markazify.com", SETTINGS), { kind: "platform", host: "markazify.com" });
    assert.equal(classifyHost("MARKAZIFY.COM:443", SETTINGS).kind, "platform");
    assert.equal(classifyHost("127.0.0.1", SETTINGS).kind, "platform");
    assert.equal(classifyHost("www.markazify.com", SETTINGS).kind, "platform");
    assert.equal(classifyHost("localhost:3000", LOCAL).kind, "platform");
    assert.equal(classifyHost("localhost", LOCAL).kind, "platform");
  });
  it("a host under the root is a subdomain (a store, a demo or a reserved label)", () => {
    assert.equal(classifyHost("zara.markazify.com", SETTINGS).kind, "subdomain");
    assert.equal(classifyHost("theme.stiletto.markazify.com", SETTINGS).kind, "subdomain");
    assert.equal(classifyHost("zara.localhost:3000", LOCAL).kind, "subdomain");
    assert.equal(classifyHost("shop1.localhost", LOCAL).kind, "subdomain");
  });
  it("any other host is a custom domain candidate, including one that only ENDS like the root", () => {
    assert.equal(classifyHost("shop.zara.pk", SETTINGS).kind, "custom");
    assert.equal(classifyHost("notmarkazify.com", SETTINGS).kind, "custom");
    assert.equal(classifyHost("markazify.com.evil.pk", SETTINGS).kind, "custom");
    assert.equal(classifyHost("shop1.localtest.me", LOCAL).kind, "custom");
    assert.equal(classifyHost("evil-localhost", LOCAL).kind, "custom");
  });
  it("a bad host is invalid", () => {
    assert.deepEqual(classifyHost("", SETTINGS), { kind: "invalid", host: "" });
    assert.equal(classifyHost("[::2]", SETTINGS).kind, "invalid");
    assert.equal(classifyHost("a b.com", SETTINGS).kind, "invalid");
  });
  it("an IPv6 platform hostname as written is the platform", () => {
    assert.equal(classifyHost("[::1]", SETTINGS).kind, "platform");
    assert.equal(classifyHost("[::1]:3000", SETTINGS).kind, "platform");
  });
  it("the label of a store subdomain is exactly one label under the root", () => {
    assert.equal(subdomainLabel("zara.markazify.com", "markazify.com"), "zara");
    assert.equal(subdomainLabel("a.b.markazify.com", "markazify.com"), null);
    assert.equal(subdomainLabel("shop.zara.pk", "markazify.com"), null);
    assert.equal(subdomainLabel("zara.localhost", "localhost:3000"), "zara");
  });
});

describe("the forwarded host (a spoofed x-forwarded-host)", () => {
  it("is ignored with no trusted proxy: the Host header is the host", () => {
    const h = headers({ host: "zara.localhost:3000", "x-forwarded-host": "shop.victim.pk" });
    assert.equal(requestHostFromHeaders(h, {}), "zara.localhost");
    assert.equal(requestHostFromHeaders(headers({ host: "evil.localhost", "x-forwarded-host": "zara.localhost" }), {}), "evil.localhost");
  });
  it("is believed when the proxy settings of D-081 say a proxy writes it, or on Vercel", () => {
    const h = headers({ host: "internal:3000", "x-forwarded-host": "shop.zara.pk" });
    assert.equal(requestHostFromHeaders(h, { TRUSTED_PROXY_HOPS: "1" }), "shop.zara.pk");
    assert.equal(requestHostFromHeaders(h, { TRUSTED_CLIENT_IP_HEADER: "x-real-ip" }), "shop.zara.pk");
    assert.equal(requestHostFromHeaders(h, { VERCEL: "1" }), "shop.zara.pk");
  });
  it("the host as written keeps its port (for a redirect in local development) and the first value only", () => {
    assert.equal(requestHostWithPort(headers({ host: "Zara.localhost:3000" }), {}), "zara.localhost:3000");
    assert.equal(requestHostWithPort(headers({ host: "a.localhost", "x-forwarded-host": "b.com:8080, c.com" }), { VERCEL: "1" }), "b.com:8080");
    assert.equal(requestHostWithPort(headers({}), {}), null);
  });
  it("zero hops, an empty header name or a word are not a trusted proxy", () => {
    for (const env of [{}, { TRUSTED_PROXY_HOPS: "0" }, { TRUSTED_PROXY_HOPS: "yes" }, { TRUSTED_CLIENT_IP_HEADER: " " }]) assert.equal(forwardedHostTrusted(env), false);
  });
  it("a trusted but empty or malformed forwarded value falls back to nothing, never to a guess", () => {
    assert.equal(requestHostFromHeaders(headers({ host: "zara.localhost", "x-forwarded-host": "  " }), { VERCEL: "1" }), "zara.localhost");
    assert.equal(requestHostFromHeaders(headers({ host: "zara.localhost", "x-forwarded-host": "a b" }), { VERCEL: "1" }), null);
    assert.equal(requestHostFromHeaders(headers({}), {}), null);
  });
});

describe("the preview cookie is host-only", () => {
  it("only a store subdomain takes a preview; a custom host, the platform and an invalid host never do", () => {
    assert.equal(hostAllowsPreview("subdomain"), true);
    for (const kind of ["custom", "platform", "invalid"] as const) assert.equal(hostAllowsPreview(kind), false, kind);
  });
});

describe("customDomainRedirect", () => {
  const live = { status: "active", domain: "shop.zara.pk", redirectToCustomDomain: true };
  const base = { requestHost: "zara.markazify.com", requestKind: "subdomain" as const, store: live, preview: false, pathAndSearch: "/products/blue-shirt?x=1" };
  it("sends the subdomain to the same path on the custom host, permanently decided by the caller", () => {
    assert.equal(customDomainRedirect(base), "https://shop.zara.pk/products/blue-shirt?x=1");
    assert.equal(customDomainRedirect({ ...base, scheme: "http" }), "http://shop.zara.pk/products/blue-shirt?x=1");
    assert.equal(customDomainRedirect({ ...base, pathAndSearch: "/" }), "https://shop.zara.pk/");
  });
  it("never redirects with the setting off, without a verified domain, for a store that is not live, for a preview or on the custom host", () => {
    assert.equal(customDomainRedirect({ ...base, store: { ...live, redirectToCustomDomain: false } }), null);
    assert.equal(customDomainRedirect({ ...base, store: { ...live, domain: null } }), null);
    assert.equal(customDomainRedirect({ ...base, store: { ...live, status: "pending" } }), null);
    assert.equal(customDomainRedirect({ ...base, store: { ...live, status: "suspended" } }), null);
    assert.equal(customDomainRedirect({ ...base, preview: true }), null);
    assert.equal(customDomainRedirect({ ...base, requestKind: "custom", requestHost: "shop.zara.pk" }), null);
    assert.equal(customDomainRedirect({ ...base, requestKind: "platform" }), null);
    assert.equal(customDomainRedirect({ ...base, requestHost: "shop.zara.pk" }), null);
  });
  it("a path that starts with two slashes cannot become another host", () => {
    assert.equal(customDomainRedirect({ ...base, pathAndSearch: "//evil.test/x" }), "https://shop.zara.pk/evil.test/x");
  });
  it("a stored domain that is not a host name gives no redirect", () => {
    assert.equal(customDomainRedirect({ ...base, store: { ...live, domain: "not a host" } }), null);
  });
});

describe("the domain-keyed cache tag", () => {
  it("is allowed, differs per host, and never collides with a store key tag", () => {
    assert.equal(domainResolveTag("shop.zara.pk"), "domain-resolve:shop.zara.pk");
    assert.equal(isAllowedRevalidateTag(domainResolveTag("shop.zara.pk")), true);
    assert.equal(isAllowedRevalidateTag(domainResolveTag("xn--bcher-kva.de")), true);
    assert.notEqual(domainResolveTag("shop.zara.pk"), domainResolveTag("shop.bilal.pk"));
    assert.notEqual(domainResolveTag("zara"), storeResolveTag("zara"));
  });
  it("refuses a tag that is not a host", () => {
    for (const bad of ["domain-resolve:", "domain-resolve:a", "domain-resolve:UPPER.com", "domain-resolve:a b.com", "domain-resolve:../x.com", "domain-resolve:" + "a".repeat(260)]) {
      assert.equal(isAllowedRevalidateTag(bad), false, bad);
    }
  });
});
