import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARTICLE_CONTENT_MAX,
  ARTICLE_EXCERPT_MAX,
  ARTICLE_SEO_DESCRIPTION_MAX,
  ARTICLE_SEO_TITLE_MAX,
  ARTICLE_SLUG_MAX,
  ARTICLE_TAGS_MAX,
  ARTICLE_TAG_MAX,
  ARTICLE_TITLE_MAX,
} from "@markaz/contracts";
import {
  ARTICLE_LIMITS,
  ARTICLE_STATUS_FILTERS,
  articleFormProblems,
  articleFormToPayload,
  articleListUrl,
  articleSlugify,
  articleStatusLabel,
  articleToForm,
  coverImageId,
  effectiveSlug,
  emptyArticleForm,
  formatArticleDate,
  insertImageMarkdown,
  parseTags,
  readArticleFailure,
} from "../lib/articles";
import {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  defaultAltFromFileName,
  fetchMediaPage,
  filterMedia,
  formatFileSize,
  uploadMedia,
  uploadProblem,
  usageItemPath,
} from "../lib/media";

// Sprint 7 (S7-B2): the blog's and the media library's pure rules on the dashboard side, plus guards on the BFF routes and the navigation.

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const form = (over: Partial<ReturnType<typeof emptyArticleForm>> = {}) => ({ ...emptyArticleForm(), title: "Summer lookbook", ...over });

test("the dashboard's limits are the contracts' limits (they cannot drift)", () => {
  assert.equal(ARTICLE_LIMITS.title.max, ARTICLE_TITLE_MAX);
  assert.equal(ARTICLE_LIMITS.slug, ARTICLE_SLUG_MAX);
  assert.equal(ARTICLE_LIMITS.excerpt, ARTICLE_EXCERPT_MAX);
  assert.equal(ARTICLE_LIMITS.content, ARTICLE_CONTENT_MAX);
  assert.equal(ARTICLE_LIMITS.tags, ARTICLE_TAGS_MAX);
  assert.equal(ARTICLE_LIMITS.tag, ARTICLE_TAG_MAX);
  assert.equal(ARTICLE_LIMITS.seoTitle, ARTICLE_SEO_TITLE_MAX);
  assert.equal(ARTICLE_LIMITS.seoDescription, ARTICLE_SEO_DESCRIPTION_MAX);
});

test("the list URL carries the status filter and the search, and leaves empty values out", () => {
  assert.equal(articleListUrl(), "/api/dashboard/storeArticles?limit=50");
  assert.equal(articleListUrl({ status: "draft" }), "/api/dashboard/storeArticles?status=draft&limit=50");
  assert.equal(articleListUrl({ status: "published", q: "  eid sale " }), "/api/dashboard/storeArticles?status=published&q=eid+sale&limit=50");
  assert.equal(articleListUrl({ status: "archived" }), "/api/dashboard/storeArticles?limit=50", "only draft and published are filters");
  assert.equal(articleListUrl({ status: "", q: "   " }), "/api/dashboard/storeArticles?limit=50");
  assert.equal(articleListUrl({ page: 3, limit: 20 }), "/api/dashboard/storeArticles?page=3&limit=20");
  assert.ok(articleListUrl({ q: "x".repeat(200) }).length < 200, "a long search is cut");
  assert.equal(articleListUrl({ q: "a&b=c" }), "/api/dashboard/storeArticles?q=a%26b%3Dc&limit=50", "the search is encoded");
  assert.deepEqual(ARTICLE_STATUS_FILTERS.map((f) => f.value), ["", "draft", "published"]);
  assert.equal(articleStatusLabel("published"), "Published");
  assert.equal(articleStatusLabel("draft"), "Draft");
  assert.equal(articleStatusLabel("archived"), "Archived");
});

test("slugs and tags", () => {
  assert.equal(articleSlugify("  Eid Mubarak! 2026  "), "eid-mubarak-2026");
  assert.equal(articleSlugify("Café — crème"), "cafe-creme");
  assert.equal(articleSlugify("عید مبارک"), "", "a title with no Latin letter has no automatic slug");
  assert.ok(articleSlugify("a".repeat(200)).length <= ARTICLE_LIMITS.slug);
  assert.deepEqual(parseTags("eid, lawn ,Eid, ,care,"), ["eid", "lawn", "care"]);
  assert.deepEqual(parseTags(""), []);
});

test("the form is checked before anything is sent, with the backend's field names", () => {
  assert.deepEqual(articleFormProblems(form()), {});
  assert.ok(articleFormProblems(form({ title: "ab" })).title);
  assert.ok(articleFormProblems(form({ title: "x".repeat(121) })).title);
  assert.ok(articleFormProblems(form({ title: "عید مبارک" })).slug, "no automatic slug: one must be typed");
  assert.equal(articleFormProblems(form({ title: "عید مبارک", slugEdited: true, slug: "eid-mubarak" })).slug, undefined);
  assert.ok(articleFormProblems(form({ slugEdited: true, slug: "Bad Slug" })).slug);
  assert.ok(articleFormProblems(form({ excerpt: "x".repeat(161) })).excerpt);
  assert.ok(articleFormProblems(form({ content: "x".repeat(50001) })).content);
  assert.ok(articleFormProblems(form({ tagsText: Array.from({ length: 11 }, (_, i) => "t" + i).join(",") })).tags);
  assert.ok(articleFormProblems(form({ tagsText: "x".repeat(31) })).tags);
  assert.ok(articleFormProblems(form({ seoTitle: "x".repeat(71) })).seoTitle);
  assert.ok(articleFormProblems(form({ seoDescription: "x".repeat(161) })).seoDescription);
});

test("the payload never carries the store, the type or the publish date; update adds the revision it read", () => {
  const values = form({ excerpt: "  Short ", content: "# Hi", coverImage: "65a000000000000000000101", status: "published", tagsText: "eid, lawn", seoTitle: " ", seoDescription: "Desc" });
  const create = articleFormToPayload(values);
  assert.deepEqual(create, {
    title: "Summer lookbook",
    slug: "summer-lookbook",
    excerpt: "Short",
    content: "# Hi",
    coverImage: "65a000000000000000000101",
    status: "published",
    tags: ["eid", "lawn"],
    seoTitle: null,
    seoDescription: "Desc",
  });
  for (const key of ["store", "type", "publishedAt", "mediaRefs", "revision"]) assert.equal(key in create, false, key);
  assert.equal(articleFormToPayload(values, 4).revision, 4);
  assert.equal(articleFormToPayload(values, 0).revision, 0, "revision 0 is sent");
  assert.equal(articleFormToPayload(form({ slugEdited: true, slug: "my-own" })).slug, "my-own");
});

test("an article loads into the form, whatever shape its cover comes in", () => {
  const loaded = articleToForm({
    id: "a1",
    title: "Old",
    slug: "old",
    status: "published",
    excerpt: null,
    content: "text",
    coverImage: { id: "65a000000000000000000101", url: "https://x.test/a.png" },
    tags: ["a", "b"],
    seoTitle: "S",
    seoDescription: null,
  });
  assert.equal(loaded.coverImage, "65a000000000000000000101");
  assert.equal(loaded.slugEdited, true, "the web address of a saved article is never rewritten from the title");
  assert.equal(loaded.tagsText, "a, b");
  assert.equal(loaded.excerpt, "");
  assert.equal(loaded.status, "published");
  assert.equal(articleToForm({ id: "a2", title: "T", slug: "t", status: "archived" }).status, "draft");
  assert.equal(coverImageId("65a000000000000000000101"), "65a000000000000000000101");
  assert.equal(coverImageId(null), null);
  assert.equal(coverImageId(undefined), null);
  assert.equal(effectiveSlug({ title: "A B", slug: "", slugEdited: false }), "a-b");
});

test("a refused save is read into a message, a field, and the two cases the form acts on", () => {
  assert.deepEqual(readArticleFailure(400, { error: "The title needs at least 3 characters.", code: "ARTICLE_INVALID", field: "title" }), {
    message: "The title needs at least 3 characters.",
    field: "title",
  });
  const conflict = readArticleFailure(409, { error: "Changed elsewhere.", code: "ARTICLE_REVISION_CONFLICT", field: "revision" });
  assert.equal(conflict.revisionConflict, true);
  const taken = readArticleFailure(409, { error: "Web address in use.", code: "ARTICLE_SLUG_TAKEN", field: "slug" });
  assert.equal(taken.slugTaken, true);
  assert.equal(taken.field, "slug");
  assert.equal(taken.revisionConflict, undefined);
  assert.equal(readArticleFailure(500, null).message, "Could not save this article.");
  assert.equal(readArticleFailure(422, { details: [{ message: "From details" }] }).message, "From details");
});

test("a picture is inserted as markdown on its own lines, with a safe description", () => {
  assert.deepEqual(insertImageMarkdown("", 0, "Lawn suit", "https://cdn.test/a.png"), { content: "![Lawn suit](https://cdn.test/a.png)\n\n", cursor: 38 });
  const mid = insertImageMarkdown("Hello world", 5, "x", "https://cdn.test/a.png");
  assert.equal(mid.content, "Hello\n\n![x](https://cdn.test/a.png)\n\n world");
  assert.equal(insertImageMarkdown("Line\n", 5, "a [b]\nc", "https://cdn.test/a.png").content, "Line\n![a b c](https://cdn.test/a.png)\n\n");
  assert.equal(insertImageMarkdown("abc", 99, "x", "https://cdn.test/a.png").content.startsWith("abc\n\n![x]"), true, "a cursor past the end is the end");
  assert.equal(formatArticleDate(null), "");
  assert.equal(formatArticleDate("not a date"), "");
  assert.match(formatArticleDate("2026-11-01T10:00:00.000Z"), /2026/);
});

// ------------------------------------------------------------------------------------------------------------------------ the media library

test("file sizes, default descriptions, and the upload rules the backend also enforces", () => {
  assert.equal(formatFileSize(12), "12 B");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(formatFileSize(null), "");
  assert.equal(formatFileSize(-1), "");
  assert.equal(defaultAltFromFileName("summer-lookbook_01.JPG"), "summer lookbook 01");
  assert.equal(defaultAltFromFileName(".png"), "Image");
  assert.equal(uploadProblem({ type: "image/png", size: 1000 }), null);
  assert.equal(uploadProblem({ type: "video/mp4", size: 1000 }), null);
  assert.match(uploadProblem({ type: "image/svg+xml", size: 1000 })!, /JPG, PNG, WebP or GIF/);
  assert.match(uploadProblem({ type: "application/pdf", size: 1000 })!, /JPG, PNG/);
  assert.match(uploadProblem({ type: "video/x-msvideo", size: 1000 })!, /MP4, WebM or MOV/);
  assert.match(uploadProblem({ type: "image/png", size: IMAGE_MAX_BYTES + 1 })!, /10 MB/);
  assert.match(uploadProblem({ type: "video/mp4", size: VIDEO_MAX_BYTES + 1 })!, /50 MB/);
  assert.match(uploadProblem({ type: "image/png", size: 0 })!, /empty/);
});

test("the library search matches the name, else the description, in any case", () => {
  const items = [
    { id: "1", name: "Summer lookbook", alt: "pic one" },
    { id: "2", name: null, alt: "Winter coat" },
    { id: "3", name: "Spare", alt: "Hidden alt words" },
  ];
  assert.deepEqual(filterMedia(items, "").map((i) => i.id), ["1", "2", "3"]);
  assert.deepEqual(filterMedia(items, "SUMMER").map((i) => i.id), ["1"]);
  assert.deepEqual(filterMedia(items, "winter").map((i) => i.id), ["2"]);
  assert.deepEqual(filterMedia(items, "hidden").map((i) => i.id), ["3"]);
  assert.deepEqual(filterMedia(items, "nothing"), []);
});

test("the library page is read from the media proxy and kept only when it is well formed; an upload is checked before it is sent", async () => {
  const seen: string[] = [];
  const okFetch = async (input: string): Promise<Response> => {
    seen.push(input);
    return new Response(
      JSON.stringify({ docs: [{ id: "m1", alt: "A", url: "https://x.test/a.png" }, { nope: true }], page: 2, totalPages: 5, totalDocs: 100 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const page = await fetchMediaPage(okFetch, 2, 24);
  assert.equal(seen[0], "/api/proxy/media?page=2&limit=24");
  assert.equal(page.ok, true);
  if (page.ok) {
    assert.deepEqual(page.value.items.map((i) => i.id), ["m1"], "a record without an id and url is dropped");
    assert.equal(page.value.totalPages, 5);
  }
  const broken = await fetchMediaPage(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }), 1);
  assert.equal(broken.ok, false);
  const refused = await fetchMediaPage(async () => new Response(JSON.stringify({ error: "Nope" }), { status: 403, headers: { "content-type": "application/json" } }), 1);
  assert.deepEqual(refused, { ok: false, message: "Nope", status: 403 });

  let sent = 0;
  const countingFetch = async (): Promise<Response> => {
    sent += 1;
    return new Response("{}", { status: 201 });
  };
  const bad = await uploadMedia(countingFetch, new File(["x"], "doc.pdf", { type: "application/pdf" }), "");
  assert.equal(bad.ok, false);
  assert.equal(sent, 0, "a refused file is never sent");
  const good = await uploadMedia(async (_url, init) => {
    const body = init?.body as FormData;
    assert.equal(body.get("alt"), "summer lookbook");
    assert.ok(body.get("file") instanceof File);
    assert.equal("store" in Object.fromEntries(body.entries()), false, "no store field in the upload");
    return new Response(JSON.stringify({ id: "m2", alt: "summer lookbook", url: "https://x.test/b.png" }), { status: 201, headers: { "content-type": "application/json" } });
  }, new File(["x"], "summer-lookbook.png", { type: "image/png" }), "");
  assert.equal(good.ok, true);
});

test("a usage entry links to where it lives, and only to real places", () => {
  assert.equal(usageItemPath("products", "65a000000000000000000301"), "/products/65a000000000000000000301");
  assert.equal(usageItemPath("articles", "65a000000000000000000302"), "/blog/65a000000000000000000302");
  assert.equal(usageItemPath("branding", "logo"), "/store");
  assert.equal(usageItemPath("products", "../../etc"), null);
  assert.equal(usageItemPath("articles", "not-an-id"), null);
  assert.equal(usageItemPath("something-new", "65a000000000000000000302"), null);
});

// ------------------------------------------------------------------------------------------------------------------- BFF routes and navigation

test("every blog BFF call is dashboard-authenticated, store-scoped, and has bindStore off (the backend's body schemas are strict)", () => {
  for (const path of ["app/api/dashboard/storeArticles/route.ts", "app/api/dashboard/storeArticles/[id]/route.ts"]) {
    const text = source(path);
    const calls = text.match(/proxy(Get|Post|Patch|Delete)\(req/g) ?? [];
    assert.ok(calls.length >= 2, path);
    assert.equal((text.match(/bindStore:\s*false/g) ?? []).length, calls.length, path + ": bindStore off on every call");
    assert.equal((text.match(/auth:\s*"dashboard"/g) ?? []).length, calls.length, path + ": every call is authenticated");
    assert.equal((text.match(/storeScope:\s*"required"/g) ?? []).length, calls.length, path + ": every call names the store");
    assert.equal(/auth:\s*"none"/.test(text), false, path + ": no unauthenticated passthrough");
  }
  const item = source("app/api/dashboard/storeArticles/[id]/route.ts");
  for (const method of ["GET", "PATCH", "DELETE"]) assert.match(item, new RegExp("export async function " + method));
  const list = source("app/api/dashboard/storeArticles/route.ts");
  for (const method of ["GET", "POST"]) assert.match(list, new RegExp("export function " + method));
  assert.equal(/where\[store\]/.test(list), false, "the old Payload-style store filter is gone");
});

test("the blog pages call the BFF routes, not the old Payload ones, and the form sends the revision", () => {
  const form = source("components/dashboard/ArticleForm.tsx");
  assert.ok(form.includes("/api/dashboard/storeArticles"));
  assert.ok(form.includes("articleFormToPayload(values, isEdit ? revision : undefined)"));
  assert.equal(/lexical|paragraphsToLexical|publishedAt:/i.test(form), false, "no more rich-text object, no client-set publish date");
  assert.equal(/dangerouslySetInnerHTML/.test(source("components/dashboard/ContentPreview.tsx")), false, "the preview never injects HTML");
  assert.equal(/dangerouslySetInnerHTML/.test(form), false);
  const list = source("app/(dashboard)/s/[storeId]/blog/page.tsx");
  assert.ok(list.includes("articleListUrl({ status, q: query })"));
});

test("the media page is in the navigation and the breadcrumb", () => {
  assert.match(source("components/dashboard/DashboardSidebar.tsx"), /href: "\/media", label: "Media"/);
  assert.match(source("components/dashboard/shared/DashboardBreadcrumb.tsx"), /media: "Media"/);
  assert.match(source("app/(dashboard)/s/[storeId]/media/page.tsx"), /<MediaLibrary \/>/);
  assert.match(source("app/api/proxy/media/route.ts"), /export function GET/);
});
