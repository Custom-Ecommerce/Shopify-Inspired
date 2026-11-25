import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAGE_BODY_MAX, PAGE_RESERVED_SLUGS, PAGE_SLUG_MAX, PAGE_SORT_MAX, PAGE_TITLE_MAX } from "@markaz/contracts";
import { PAGE_TEMPLATES } from "@markaz/platform-kit/page-templates";
import {
  PAGE_LIMITS,
  RESERVED_PAGE_SLUGS,
  createPageFromTemplate,
  effectivePageSlug,
  emptyPageForm,
  fetchPages,
  isReservedSlug,
  pageFormProblems,
  pageFormToPayload,
  pageStatusLabel,
  pageToForm,
  parseSortOrder,
  placeholderWarning,
  publishConfirmationMessage,
  publishNeedsConfirmation,
  readPageFailure,
  readPageList,
  textHasPlaceholder,
} from "../lib/pages";

// Sprint 7 (S7-B3): the pages manager's pure rules, its calls with a stubbed store fetch, and guards on the BFF routes, the screens and the navigation.

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const form = (over: Partial<ReturnType<typeof emptyPageForm>> = {}) => ({ ...emptyPageForm(), title: "Size guide", ...over });

test("the dashboard's limits and reserved words are the contracts' (they cannot drift)", () => {
  assert.equal(PAGE_LIMITS.title.max, PAGE_TITLE_MAX);
  assert.equal(PAGE_LIMITS.slug, PAGE_SLUG_MAX);
  assert.equal(PAGE_LIMITS.body, PAGE_BODY_MAX);
  assert.equal(PAGE_LIMITS.sortOrder, PAGE_SORT_MAX);
  assert.deepEqual([...RESERVED_PAGE_SLUGS].sort(), [...PAGE_RESERVED_SLUGS].sort());
  for (const word of ["products", "cart", "checkout", "track", "favourites", "search", "collections", "blog", "pages", "account", "api"]) assert.equal(isReservedSlug(word), true, word);
  assert.equal(isReservedSlug(" BLOG "), true);
  assert.equal(isReservedSlug("about"), false);
  assert.equal(isReservedSlug("blog-rules"), false);
});

test("the form is checked before anything is sent, with the backend's field names", () => {
  assert.deepEqual(pageFormProblems(form()), {});
  assert.ok(pageFormProblems(form({ title: "a" })).title);
  assert.ok(pageFormProblems(form({ title: "x".repeat(121) })).title);
  assert.ok(pageFormProblems(form({ title: "ہمارے بارے میں" })).slug, "no automatic slug for an Urdu title");
  assert.equal(pageFormProblems(form({ title: "ہمارے بارے میں", slugEdited: true, slug: "about-us" })).slug, undefined);
  assert.ok(pageFormProblems(form({ slugEdited: true, slug: "Bad Slug" })).slug);
  assert.match(pageFormProblems(form({ title: "Blog" })).slug!, /used by the store itself/, "a reserved word taken from the title is caught");
  assert.match(pageFormProblems(form({ slugEdited: true, slug: "cart" })).slug!, /used by the store itself/);
  assert.ok(pageFormProblems(form({ body: "x".repeat(50001) })).body);
  assert.ok(pageFormProblems(form({ sortOrderText: "-1" })).sortOrder);
  assert.ok(pageFormProblems(form({ sortOrderText: "10000" })).sortOrder);
  assert.ok(pageFormProblems(form({ sortOrderText: "1.5" })).sortOrder);
  assert.ok(pageFormProblems(form({ sortOrderText: "abc" })).sortOrder);
  assert.equal(parseSortOrder(""), 0);
  assert.equal(parseSortOrder(" 7 "), 7);
  assert.equal(parseSortOrder("9999"), 9999);
});

test("the payload never carries the store, the template, the references or the publish date; update adds the revision it read", () => {
  const values = form({ body: "# Sizes", status: "published", showInFooter: true, sortOrderText: "5" });
  const create = pageFormToPayload(values);
  assert.deepEqual(create, { title: "Size guide", slug: "size-guide", body: "# Sizes", status: "published", showInFooter: true, sortOrder: 5 });
  for (const key of ["store", "template", "mediaRefs", "publishedAt", "revision"]) assert.equal(key in create, false, key);
  assert.equal(pageFormToPayload(values, 3).revision, 3);
  assert.equal(pageFormToPayload(values, 0).revision, 0);
  assert.equal(pageFormToPayload(form({ slugEdited: true, slug: "mine" })).slug, "mine");
  assert.equal(effectivePageSlug({ title: "A B", slug: "", slugEdited: false }), "a-b");
});

test("a page loads into the form, and its web address is not rewritten from the title", () => {
  const loaded = pageToForm({ id: "p1", title: "About us", slug: "about", status: "published", showInFooter: true, sortOrder: 20, body: "text" });
  assert.equal(loaded.slugEdited, true);
  assert.equal(loaded.status, "published");
  assert.equal(loaded.sortOrderText, "20");
  assert.equal(loaded.showInFooter, true);
  assert.equal(pageToForm({ id: "p2", title: "T", slug: "t", status: "archived", showInFooter: false, sortOrder: 0, body: "" }).status, "draft");
  assert.equal(pageStatusLabel("published"), "Published");
  assert.equal(pageStatusLabel("draft"), "Draft");
});

test("a placeholder in the text shows a warning that counts them, and goes away once edited", () => {
  assert.equal(placeholderWarning("No placeholders here"), null);
  assert.match(placeholderWarning("Call [[EDIT: your number]]")!, /1 placeholder/);
  assert.match(placeholderWarning("[[EDIT: a]] and [[EDIT: b]]")!, /2 placeholders/);
  assert.equal(textHasPlaceholder("[[EDIT: x]]"), true);
  assert.equal(textHasPlaceholder("done"), false);
  for (const template of PAGE_TEMPLATES) assert.ok(placeholderWarning(template.body), template.key + " warns until it is edited");
  assert.equal(placeholderWarning(PAGE_TEMPLATES[1]!.body.replace(/\[\[EDIT:[^\]]*\]\]/g, "0300 1234567")), null);
});

test("publishing asks for confirmation only when a placeholder is still in the text", () => {
  assert.equal(publishNeedsConfirmation({ status: "published", body: "Call [[EDIT: number]]" }), true);
  assert.equal(publishNeedsConfirmation({ status: "published", body: "Call 0300" }), false);
  assert.equal(publishNeedsConfirmation({ status: "draft", body: "Call [[EDIT: number]]" }), false, "a draft is private: no need to ask");
  assert.match(publishConfirmationMessage("[[EDIT: a]]"), /^1 placeholder is still/);
  assert.match(publishConfirmationMessage("[[EDIT: a]] [[EDIT: b]]"), /^2 placeholders are still/);
  assert.match(publishConfirmationMessage("[[EDIT: a]]"), /Publish anyway\?$/);
});

test("a refused save is read into a message, a field and the cases the form acts on", () => {
  assert.deepEqual(readPageFailure(400, { error: "The title needs at least 2 characters.", code: "PAGE_INVALID", field: "title" }), { message: "The title needs at least 2 characters.", field: "title" });
  assert.equal(readPageFailure(409, { error: "x", code: "PAGE_REVISION_CONFLICT", field: "revision" }).revisionConflict, true);
  const taken = readPageFailure(409, { error: "x", code: "PAGE_SLUG_TAKEN", field: "slug" });
  assert.equal(taken.slugTaken, true);
  assert.equal(taken.revisionConflict, undefined);
  const reserved = readPageFailure(400, { error: "x", code: "PAGE_SLUG_RESERVED", field: "slug" });
  assert.equal(reserved.slugReserved, true);
  assert.equal(reserved.field, "slug");
  assert.equal(readPageFailure(500, null).message, "Could not save this page.");
});

test("the list answer is read defensively", () => {
  const answer = readPageList({
    docs: [{ id: "p1", title: "A", slug: "a", status: "draft", showInFooter: false, sortOrder: 0 }, { nope: true }],
    templates: [{ key: "about", slug: "about", title: "About us", legal: false, showInFooter: true, exists: false }, { bad: 1 }],
  });
  assert.deepEqual(answer!.pages.map((p) => p.id), ["p1"]);
  assert.deepEqual(answer!.templates.map((t) => t.key), ["about"]);
  assert.equal(readPageList(null), null);
  assert.equal(readPageList({ docs: [] }), null);
});

test("opening the manager only READS: fetchPages makes a GET and never a POST; a template is made only by createPageFromTemplate, one at a time", async () => {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchStub = (payload: unknown, status = 200) => async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  const listed = await fetchPages(fetchStub({ docs: [], templates: [{ key: "about", slug: "about", title: "About us", legal: false, showInFooter: true, exists: false }] }));
  assert.equal(listed.ok, true);
  assert.deepEqual(calls.map((c) => c.method), ["GET"], "no page is created behind the seller's back");
  assert.equal(calls[0]!.url, "/api/dashboard/storePages");

  calls.length = 0;
  const made = await createPageFromTemplate(fetchStub({ id: "p1", title: "About us", slug: "about", status: "draft", showInFooter: true, sortOrder: 0, body: "x" }, 201), "about");
  assert.equal(made.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "/api/dashboard/storePages/from-template");
  assert.deepEqual(JSON.parse(calls[0]!.body!), { template: "about" }, "the template's key and nothing else");

  const taken = await createPageFromTemplate(fetchStub({ error: "You already have a page.", code: "PAGE_SLUG_TAKEN", field: "template" }, 409), "about");
  assert.equal(taken.ok, false);
  if (!taken.ok) assert.equal(taken.failure.slugTaken, true);
  const down = await fetchPages(async () => {
    throw new Error("offline");
  });
  assert.deepEqual(down, { ok: false, failure: { message: "Could not reach the backend. Please try again." }, status: 0 });
  assert.equal((await fetchPages(fetchStub({ not: "a list" }))).ok, false);
});

test("every pages BFF call is dashboard-authenticated, store-scoped, and has bindStore off (the backend's body schemas are strict)", () => {
  for (const path of ["app/api/dashboard/storePages/route.ts", "app/api/dashboard/storePages/[id]/route.ts", "app/api/dashboard/storePages/from-template/route.ts"]) {
    const text = source(path);
    const calls = text.match(/proxy(Get|Post|Patch|Delete)\(req/g) ?? [];
    assert.ok(calls.length >= 1, path);
    assert.equal((text.match(/bindStore:\s*false/g) ?? []).length, calls.length, path + ": bindStore off on every call");
    assert.equal((text.match(/auth:\s*"dashboard"/g) ?? []).length, calls.length, path + ": every call is authenticated");
    assert.equal((text.match(/storeScope:\s*"required"/g) ?? []).length, calls.length, path + ": every call names the store");
    assert.equal(/auth:\s*"none"/.test(text), false, path);
  }
  const item = source("app/api/dashboard/storePages/[id]/route.ts");
  for (const method of ["GET", "PATCH", "DELETE"]) assert.match(item, new RegExp("export async function " + method));
  assert.match(source("app/api/dashboard/storePages/route.ts"), /export function GET/);
  assert.match(source("app/api/dashboard/storePages/route.ts"), /export function POST/);
  assert.match(source("app/api/dashboard/storePages/from-template/route.ts"), /export function POST/);
});

test("the pages screens reuse the markdown preview, ask before publishing a placeholder, and never inject HTML", () => {
  const formSource = source("components/dashboard/PageForm.tsx");
  assert.ok(formSource.includes("ContentPreview"));
  assert.ok(formSource.includes("MediaPickerDialog"));
  assert.ok(formSource.includes("publishNeedsConfirmation(values)"));
  assert.ok(formSource.includes("window.confirm(publishConfirmationMessage(values.body))"));
  assert.ok(formSource.includes("placeholder-warning"));
  assert.ok(formSource.includes("pageFormToPayload(values, isEdit ? revision : undefined)"));
  assert.equal(/dangerouslySetInnerHTML/.test(formSource), false);
  const list = source("app/(dashboard)/s/[storeId]/pages/page.tsx");
  assert.ok(list.includes("fetchPages(storeFetch)"));
  assert.ok(list.includes("createPageFromTemplate(storeFetch, key)"));
  assert.ok(list.includes("Create from template"));
});

test("the pages screen is in the navigation and the breadcrumb", () => {
  assert.match(source("components/dashboard/DashboardSidebar.tsx"), /href: "\/pages", label: "Pages"/);
  assert.match(source("components/dashboard/shared/DashboardBreadcrumb.tsx"), /pages: "Pages"/);
});
