/*
 * Sprint 7 (S7-B3): checks for the storefront's blog and static pages: the wire schemas (the tree is checked again), the remote transport (paths, the cache
 * tag, the 404 meanings), the view-models, the footer links, the sitemap, the canonical address, the loaders and the React renderer of the safe tree. The
 * storefront has no unit test runner, so every rule lives in this package. From packages/storefront-data run:
 *
 *   npx tsx test/blog-pages.check.ts        (or: pnpm test, which runs every *.check.ts)
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import type { ReactElement, ReactNode } from "react";
import { isAllowedRevalidateTag, storeTags } from "@markaz/platform-kit/cache-tags";
import { parseContent } from "@markaz/platform-kit/content-markdown";
import { WireArticle, WireArticleListEnvelope, WireContentTree, WirePageEnvelope, WirePageListEnvelope, treeDepth } from "../src/transport/content-wire";
import { createRemoteTransport } from "../src/transport/remote";
import { createMockTransport } from "../src/transport/mock";
import { TransportUnavailableError } from "../src/transport/errors";
import type { StorefrontTransport } from "../src/transport/types";
import type { StorefrontArticle, StorefrontPage, StorefrontPageLink } from "../src/transport/content-types";
import {
  articleDescription,
  articleTitle,
  buildStoreRobotsTxt,
  buildStoreSitemapXml,
  canonicalUrl,
  cleanOrigin,
  contentFooterLinks,
  escapeXml,
  formatPublishedDate,
  toArticleCardVM,
  toArticleVM,
} from "../src/domain/content";
import { loadArticlePage, loadBlogList, loadContentFooterLinks, loadContentPage, loadSitemapData } from "../src/server/content";
import { renderContentTree } from "../src/view-models/content-nodes";
import { storePaths } from "../src/view-models/paths";

const STORE = "65a000000000000000000011";

const summary = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  slug: "eid-collection",
  title: "Eid collection",
  excerpt: "Summer edit",
  coverImageUrl: "https://cdn.test/a.png",
  tags: ["eid"],
  publishedAt: "2026-11-14T10:00:00.000Z",
  ...over,
});

const article = (over: Record<string, unknown> = {}): StorefrontArticle => ({ ...summary(), content: parseContent("# Hi\n\nHello **world**"), seoTitle: null, seoDescription: null, ...over }) as StorefrontArticle;
const page = (over: Record<string, unknown> = {}): StorefrontPage => ({ slug: "about", title: "About us", content: parseContent("# About\n\nWe sell lawn."), publishedAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", ...over }) as StorefrontPage;
const link = (over: Record<string, unknown> = {}): StorefrontPageLink => ({ slug: "about", title: "About us", showInFooter: true, sortOrder: 0, updatedAt: "2026-11-02T00:00:00.000Z", ...over }) as StorefrontPageLink;

type Seen = { url: string; init: Record<string, unknown> };

/** A fetch that answers from a table and records what it was asked. */
function fakeFetch(answers: Record<string, { status: number; body: unknown }>): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init: (init ?? {}) as Record<string, unknown> });
    const path = url.replace(/^http:\/\/backend\.test\/api\/storefront\/v1\/stores\/[^/]+/, "");
    const answer = answers[path];
    if (!answer) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const remote = (answers: Record<string, { status: number; body: unknown }>, previewToken?: string) => {
  const { fetchImpl, seen } = fakeFetch(answers);
  return { transport: createRemoteTransport({ baseUrl: "http://backend.test", storeId: STORE, fetchImpl, previewToken }), seen };
};

const notFound = (code: string) => ({ status: 404, body: { error: { code, message: "Not found." } } });

/** Every node of what a renderer returned, depth first (host elements only: the renderer makes no component). */
function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node !== null && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<Record<string, unknown>>;
    visit(el);
    walk(el.props.children as ReactNode, visit);
  }
}

const textOf = (node: ReactNode): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node !== null && typeof node === "object" && "props" in node) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return "";
};

async function main(): Promise<void> {
  // ----------------------------------------------------------------------------------------------------------------- the wire checks the tree again
  {
    const tree = parseContent("# T\n\n**b** [ok](https://example.com) ![p](https://cdn.test/p.png)\n\n- one\n- two");
    assert.deepEqual(WireContentTree.parse(tree), tree, "a tree the parser made passes unchanged");
    assert.deepEqual(WireContentTree.parse([]), []);

    const bad: Array<[string, unknown]> = [
      ["a javascript link", [{ type: "paragraph", children: [{ type: "link", href: "javascript:alert(1)", children: [{ type: "text", text: "x" }] }] }]],
      ["a data link", [{ type: "paragraph", children: [{ type: "link", href: "data:text/html,<b>", children: [] }] }]],
      ["a relative link", [{ type: "paragraph", children: [{ type: "link", href: "/admin", children: [] }] }]],
      ["an http image", [{ type: "paragraph", children: [{ type: "image", src: "http://cdn.test/p.png", alt: "" }] }]],
      ["a javascript image", [{ type: "paragraph", children: [{ type: "image", src: "javascript:alert(1)", alt: "" }] }]],
      ["a node type outside the subset", [{ type: "html", html: "<script>alert(1)</script>" }]],
      ["an inline node outside the subset", [{ type: "paragraph", children: [{ type: "script", text: "x" }] }]],
      ["a heading that is not h2 to h4", [{ type: "heading", level: 1, children: [] }]],
      ["not an array", { type: "paragraph" }],
    ];
    for (const [label, value] of bad) assert.equal(WireContentTree.safeParse(value).success, false, label);

    const withExtra = WireContentTree.parse([{ type: "paragraph", onclick: "x()", html: "<b>", children: [{ type: "text", text: "hi", style: "x" }] }]);
    assert.deepEqual(withExtra, [{ type: "paragraph", children: [{ type: "text", text: "hi" }] }], "unknown keys are dropped");

    let deep: unknown = { type: "text", text: "x" };
    for (let i = 0; i < 12; i += 1) deep = { type: "strong", children: [deep] };
    assert.equal(WireContentTree.safeParse([{ type: "paragraph", children: [deep] }]).success, false, "a tree that nests too deeply is refused");
    assert.equal(treeDepth(parseContent("**a *b* c**")), 3);

    assert.equal(WireArticle.safeParse({ ...summary(), content: tree, seoTitle: null, seoDescription: null }).success, true);
    assert.equal(WireArticle.safeParse({ ...summary({ coverImageUrl: "http://insecure.test/a.png" }), content: tree, seoTitle: null, seoDescription: null }).success, false, "an insecure cover is refused");
    assert.equal(WireArticle.safeParse({ ...summary({ coverImageUrl: null }), content: tree, seoTitle: null, seoDescription: null }).success, true);
    assert.equal(WireArticleListEnvelope.safeParse({ data: [summary()], page: 1, totalPages: 1, totalDocs: 1 }).success, true);
    const stripped = WireArticleListEnvelope.parse({ data: [{ ...summary(), status: "draft", revision: 3, mediaRefs: ["x"] }], page: 1, totalPages: 1, totalDocs: 1 });
    assert.deepEqual(Object.keys(stripped.data[0]!).sort(), ["coverImageUrl", "excerpt", "id", "publishedAt", "slug", "tags", "title"], "private keys never survive the wire");
    assert.equal(WirePageEnvelope.safeParse({ data: page() }).success, true);
    assert.equal(WirePageListEnvelope.safeParse({ data: [link()] }).success, true);
    assert.equal(WirePageListEnvelope.safeParse({ data: [{ slug: "", title: "x", showInFooter: true, sortOrder: 0, updatedAt: null }] }).success, false);
  }

  // ----------------------------------------------------------------------------------------------------------------------- the remote transport
  {
    const list = { status: 200, body: { data: [summary()], page: 1, totalPages: 1, totalDocs: 1 } };
    const { transport, seen } = remote({
      "/articles?limit=12": list,
      "/articles?page=2&limit=5": { status: 200, body: { data: [], page: 2, totalPages: 2, totalDocs: 6 } },
      "/articles/eid-collection": { status: 200, body: { data: { ...summary(), content: parseContent("Hello"), seoTitle: null, seoDescription: null } } },
      "/articles/secret-draft": notFound("ARTICLE_NOT_FOUND"),
      "/pages": { status: 200, body: { data: [link()] } },
      "/pages/about": { status: 200, body: { data: page() } },
      "/pages/contact": notFound("PAGE_NOT_PUBLISHED"),
      "/pages/privacy": notFound("PAGE_NOT_FOUND"),
      "/articles/evil": { status: 200, body: { data: { ...summary({ slug: "evil" }), content: [{ type: "paragraph", children: [{ type: "link", href: "javascript:alert(1)", children: [] }] }], seoTitle: null, seoDescription: null } } },
      "/articles/broken": { status: 502, body: { error: { code: "STOREFRONT_UNAVAILABLE" } } },
    });
    const listed = await transport.listArticles!();
    assert.equal(listed.items[0]!.slug, "eid-collection");
    assert.equal(listed.totalDocs, 1);
    assert.equal((await transport.listArticles!(2, 5)).totalPages, 2);
    assert.equal((await transport.getArticle!("eid-collection"))!.title, "Eid collection");
    assert.equal(await transport.getArticle!("secret-draft"), null, "ARTICLE_NOT_FOUND is null");
    assert.equal((await transport.listPages!())[0]!.slug, "about");
    assert.equal((await transport.getPage!("about")).kind, "found");
    assert.deepEqual(await transport.getPage!("contact"), { kind: "draft" });
    assert.deepEqual(await transport.getPage!("privacy"), { kind: "none" });

    // Every read is kept under the store's `static` tag: the one tag the seller backend's revalidateStore drops on every publish, unpublish, edit and delete.
    const tag = storeTags.static(STORE);
    assert.equal(isAllowedRevalidateTag(tag), true, "the revalidate endpoint accepts the tag");
    for (const call of seen) {
      const next = call.init.next as { tags: string[]; revalidate: number } | undefined;
      assert.ok(next, call.url + " is cached");
      assert.deepEqual(next!.tags, [tag], call.url + " carries the static tag");
    }
    assert.equal(seen[0]!.url, "http://backend.test/api/storefront/v1/stores/" + STORE + "/articles?limit=12");

    await assert.rejects(() => transport.getArticle!("evil"), (error: unknown) => error instanceof TransportUnavailableError && error.reason === "invalid_response", "a tree with a javascript link is refused, not rendered");
    await assert.rejects(() => transport.getArticle!("broken"), (error: unknown) => error instanceof TransportUnavailableError);
    await assert.rejects(() => transport.getPage!("nothing-answers"), (error: unknown) => error instanceof TransportUnavailableError);
  }

  // A preview is never cached, like every other read.
  {
    const { transport, seen } = remote({ "/articles?limit=12": { status: 200, body: { data: [], page: 1, totalPages: 1, totalDocs: 0 } } }, "p".repeat(40));
    await transport.listArticles!();
    assert.equal(seen[0]!.init.cache, "no-store");
    assert.equal(seen[0]!.init.next, undefined);
  }

  // ------------------------------------------------------------------------------------------------------------------------------ view-models
  {
    const card = toArticleCardVM(summary());
    assert.equal(card.href, "/blog/eid-collection");
    assert.equal(card.dateLabel, "14 Nov 2026");
    assert.equal(card.dateIso, "2026-11-14T10:00:00.000Z");
    assert.equal(card.coverUrl, "https://cdn.test/a.png");
    assert.equal(toArticleCardVM(summary({ publishedAt: null })).dateLabel, null);
    assert.equal(formatPublishedDate("not a date"), null);
    assert.equal(formatPublishedDate("2026-01-01T00:30:00.000Z"), "1 Jan 2026", "UTC, so the server and the browser agree");
    assert.equal(toArticleVM(article({ seoTitle: "SEO" })).seoTitle, "SEO");
    assert.equal(storePaths.blog, "/blog");
    assert.equal(storePaths.article("a b"), "/blog/a%20b");

    assert.equal(articleTitle({ title: "T", seoTitle: " Search title " }), "Search title");
    assert.equal(articleTitle({ title: "T", seoTitle: null }), "T");
    assert.equal(articleDescription({ excerpt: "Short", seoDescription: null }), "Short");
    assert.equal(articleDescription({ excerpt: "Short", seoDescription: "Wins" }), "Wins");
    assert.equal(articleDescription({ excerpt: null, seoDescription: null }), null);
    assert.equal(articleDescription({ excerpt: "x".repeat(300), seoDescription: null })!.length, 160);
  }

  // --------------------------------------------------------------------------------------------------------------------------------- footer links
  {
    const pages = [link({ slug: "shipping", title: "Shipping", sortOrder: 10 }), link({ slug: "about", title: "About us", sortOrder: 5 }), link({ slug: "faq", title: "FAQ", showInFooter: false })];
    assert.deepEqual(contentFooterLinks(pages, true), [
      { label: "About us", href: "/pages/about" },
      { label: "Shipping", href: "/pages/shipping" },
      { label: "Blog", href: "/blog" },
    ], "footer pages in their order, then the blog; a page not shown in the footer is not there");
    assert.deepEqual(contentFooterLinks([], false), []);
    assert.deepEqual(contentFooterLinks([], true), [{ label: "Blog", href: "/blog" }], "the blog link appears only when there is an article");
  }

  // ------------------------------------------------------------------------------------------------------------------------- canonical and sitemap
  {
    assert.equal(cleanOrigin("https://zara.markazify.com/some/path?x=1"), "https://zara.markazify.com");
    assert.equal(cleanOrigin("http://localhost:3000"), "http://localhost:3000");
    for (const bad of ["javascript:alert(1)", "ftp://x.test", "https://user:pass@x.test", "not a url", "", null, undefined]) assert.equal(cleanOrigin(bad), null, String(bad));
    assert.equal(canonicalUrl("https://zara.markazify.com", "/blog/eid"), "https://zara.markazify.com/blog/eid");
    assert.equal(canonicalUrl("https://zara.markazify.com/", "blog"), "https://zara.markazify.com/blog");
    assert.equal(canonicalUrl("javascript:x", "/blog"), null);

    const xml = buildStoreSitemapXml({
      origin: "https://zara.markazify.com",
      articles: [{ slug: "newest", publishedAt: "2026-11-12T10:00:00.000Z" }, { slug: "older", publishedAt: null }],
      pages: [{ slug: "about", updatedAt: "2026-11-02T00:00:00.000Z" }],
    })!;
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    for (const loc of ["/", "/products", "/blog", "/blog/newest", "/blog/older", "/pages/about"]) assert.ok(xml.includes("<loc>https://zara.markazify.com" + loc + "</loc>"), loc);
    assert.ok(xml.includes("<lastmod>2026-11-12T10:00:00.000Z</lastmod>"));
    assert.equal(xml.includes("secret"), false);
    const noBlog = buildStoreSitemapXml({ origin: "https://zara.markazify.com", articles: [], pages: [] })!;
    assert.equal(noBlog.includes("/blog"), false, "no articles, no blog entry");
    const odd = buildStoreSitemapXml({ origin: "https://zara.markazify.com", articles: [{ slug: "a&b<c>", publishedAt: null }], pages: [] })!;
    assert.ok(!odd.includes("<c>") && odd.includes("&amp;") || odd.includes("%26"), "a slug is encoded and escaped");
    assert.equal(escapeXml("<a href=\"x\">&'"), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
    assert.equal(buildStoreSitemapXml({ origin: "javascript:x", articles: [], pages: [] }), null);

    assert.equal(buildStoreRobotsTxt({ origin: "https://zara.markazify.com", live: true }), "User-agent: *\nAllow: /\nSitemap: https://zara.markazify.com/sitemap.xml\n");
    assert.equal(buildStoreRobotsTxt({ origin: "https://zara.markazify.com", live: false }), "User-agent: *\nDisallow: /\n", "a preview or a store not serving is closed");
    assert.equal(buildStoreRobotsTxt({ origin: null, live: true }), "User-agent: *\nAllow: /\n");
  }

  // --------------------------------------------------------------------------------------------------------------------------------- the loaders
  {
    const mock = createMockTransport({ products: [], articles: [article(), article({ id: "a2", slug: "second" })], pages: [page()] });
    const blog = await loadBlogList(mock);
    assert.equal(blog.status, "ok");
    if (blog.status === "ok") assert.deepEqual(blog.articles.map((a) => a.slug), ["eid-collection", "second"]);
    const one = await loadArticlePage(mock, "second");
    assert.equal(one.status, "ok");
    assert.equal((await loadArticlePage(mock, "nope")).status, "not-found");
    const found = await loadContentPage(mock, "about");
    assert.equal(found.status, "ok");
    assert.deepEqual(await loadContentPage(mock, "contact"), { status: "none" });
    assert.deepEqual(await loadContentFooterLinks(mock), [{ label: "About us", href: "/pages/about" }, { label: "Blog", href: "/blog" }]);
    const sitemap = await loadSitemapData(mock);
    assert.deepEqual(sitemap.articles.map((a) => a.slug), ["eid-collection", "second"]);
    assert.deepEqual(sitemap.pages.map((p) => p.slug), ["about"]);

    // A transport with no blog methods has no blog, and the store still works.
    const bare = { kind: "mock" } as unknown as StorefrontTransport;
    assert.deepEqual(await loadBlogList(bare), { status: "ok", articles: [], page: 1, totalPages: 1 });
    assert.deepEqual(await loadArticlePage(bare, "x"), { status: "not-found" });
    assert.deepEqual(await loadContentPage(bare, "about"), { status: "none" });
    assert.deepEqual(await loadContentFooterLinks(bare), []);

    // A backend that cannot be reached is a value, never a thrown error; the footer and the sitemap simply have nothing extra.
    const down = {
      kind: "remote",
      listArticles: async () => {
        throw new TransportUnavailableError("network", "down");
      },
      getArticle: async () => {
        throw new TransportUnavailableError("timeout", "slow");
      },
      listPages: async () => {
        throw new TransportUnavailableError("network", "down");
      },
      getPage: async () => {
        throw new TransportUnavailableError("network", "down");
      },
    } as unknown as StorefrontTransport;
    assert.equal((await loadBlogList(down)).status, "unavailable");
    assert.deepEqual(await loadArticlePage(down, "x"), { status: "unavailable", reason: "timeout" });
    assert.equal((await loadContentPage(down, "about")).status, "unavailable");
    assert.deepEqual(await loadContentFooterLinks(down), []);
    assert.deepEqual(await loadSitemapData(down), { articles: [], pages: [] });

    // A draft page is its own answer: the route must not use the default copy for it.
    const drafty = {
      kind: "remote",
      getPage: async (slug: string) => (slug === "contact" ? { kind: "draft" } : { kind: "none" }),
    } as unknown as StorefrontTransport;
    assert.deepEqual(await loadContentPage(drafty, "contact"), { status: "draft" });
    assert.deepEqual(await loadContentPage(drafty, "about"), { status: "none" });
  }

  // -------------------------------------------------------------------------------------------------------------- the React renderer of the safe tree
  {
    const tree = parseContent("# Title\n\nHello **bold** *it* [go](https://example.com/a) [mail](mailto:a@b.co) ![pic](https://cdn.test/p.png)\n\n- one\n- two\n\n1. first");
    const out = renderContentTree(tree);
    const tags: string[] = [];
    walk(out, (el) => tags.push(String(el.type)));
    assert.deepEqual(tags.filter((t) => ["h2", "p", "ul", "ol", "li", "strong", "em", "a", "img"].includes(t)).sort(), ["a", "a", "em", "h2", "img", "li", "li", "li", "ol", "p", "strong", "ul"]);
    assert.equal(tags.every((t) => typeof t === "string" && /^[a-z0-9]+$/.test(t)), true, "host elements only: no component, nothing to inject");

    const links: Array<Record<string, unknown>> = [];
    walk(out, (el) => {
      assert.equal("dangerouslySetInnerHTML" in el.props, false, "no raw HTML anywhere");
      if (el.type === "a") links.push(el.props);
    });
    assert.equal(links[0]!.href, "https://example.com/a");
    assert.equal(links[0]!.target, "_blank");
    assert.match(String(links[0]!.rel), /noopener/);
    assert.equal(links[1]!.href, "mailto:a@b.co");
    assert.equal(links[1]!.target, undefined, "a mail link opens in place");

    // Markup is a string child, which React escapes; a bad address is not in the tree to begin with.
    const evil = renderContentTree(parseContent("<script>alert(1)</script> <b onclick=x>y</b> [bad](javascript:alert(2)) ![i](http://x.test/i.png)"));
    const evilTags: string[] = [];
    walk(evil, (el) => evilTags.push(String(el.type)));
    assert.deepEqual(evilTags, ["p"], "a paragraph of text and nothing else");
    assert.ok(textOf(evil).includes("<script>alert(1)</script>"), "the markup is text");
    assert.equal(textOf(evil).includes("javascript:"), false);
    assert.deepEqual(renderContentTree([]), []);
    const classed = renderContentTree(parseContent("# T\n\ntext"), { h2: "big", paragraph: "body" });
    const classes: unknown[] = [];
    walk(classed, (el) => classes.push(el.props.className));
    assert.deepEqual(classes, ["big", "body"]);
  }

  console.log("blog and pages checks passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
