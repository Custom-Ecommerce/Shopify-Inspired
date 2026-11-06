import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_CATEGORY_FORM,
  categoryStateToQuery,
  formFromCategory,
  issuesToErrors,
  parseCategoryState,
  slugify,
  toCreateRequest,
  toUpdateRequest,
  validateCategoryForm,
} from "../lib/categories";

const NOW = "2026-10-11T10:00:00.000Z";
const category = { id: "65a000000000000000000001", name: "Lawn", slug: "lawn", order: 2, description: null, createdAt: NOW, updatedAt: NOW };
const params = (query: string) => new URLSearchParams(query);

test("list state reads page and search, and falls back on anything unreadable", () => {
  assert.deepEqual(parseCategoryState(params("")), { page: 1, q: "" });
  assert.deepEqual(parseCategoryState(params("page=3&q=%20lawn%20")), { page: 3, q: "lawn" });
  assert.deepEqual(parseCategoryState(params("page=-1&q=" + "a".repeat(300))), { page: 1, q: "a".repeat(100) });
});

test("the query leaves defaults out and adds the page size only for the backend call", () => {
  assert.equal(categoryStateToQuery({ page: 1, q: "" }), "");
  assert.equal(categoryStateToQuery({ page: 2, q: "lawn" }), "page=2&q=lawn");
  assert.equal(categoryStateToQuery({ page: 1, q: "" }, true), "limit=20");
});

test("slugify drops accents and symbols", () => {
  assert.equal(slugify("  Summer Lawn 2026!  "), "summer-lawn-2026");
  assert.equal(slugify("Café & Chai"), "cafe-chai");
  assert.equal(slugify("!!!"), "");
});

test("a new category needs a name; a blank slug is fine on create and an error on edit", () => {
  assert.deepEqual(validateCategoryForm({ ...EMPTY_CATEGORY_FORM, name: "Lawn" }, "create"), {});
  assert.equal(validateCategoryForm(EMPTY_CATEGORY_FORM, "create").name, "Enter a name.");
  assert.equal(validateCategoryForm({ ...EMPTY_CATEGORY_FORM, name: "Lawn" }, "edit").slug, "Enter a slug.");
  assert.equal(validateCategoryForm({ ...EMPTY_CATEGORY_FORM, name: "!!!" }, "create").slug, "A slug could not be made from the name. Enter one.");
});

test("the form refuses a bad slug, order, and description with the backend's rules", () => {
  const base = { ...EMPTY_CATEGORY_FORM, name: "Lawn" };
  assert.ok(validateCategoryForm({ ...base, slug: "Bad Slug" }, "create").slug);
  assert.ok(validateCategoryForm({ ...base, slug: "a--b" }, "create").slug);
  assert.ok(validateCategoryForm({ ...base, order: "-1" }, "create").order);
  assert.ok(validateCategoryForm({ ...base, order: "1.5" }, "create").order);
  assert.ok(validateCategoryForm({ ...base, order: "10000" }, "create").order);
  assert.equal(validateCategoryForm({ ...base, order: "" }, "create").order, undefined);
  assert.ok(validateCategoryForm({ ...base, description: "x".repeat(501) }, "create").description);
  assert.ok(validateCategoryForm({ ...base, name: "x".repeat(81) }, "create").name);
});

test("the create body leaves a blank slug out and turns a blank description into null", () => {
  assert.deepEqual(toCreateRequest({ name: " Lawn ", slug: " ", order: "", description: " " }), { name: "Lawn", order: 0, description: null });
  assert.deepEqual(toCreateRequest({ name: "Lawn", slug: "lawn-2", order: "4", description: "Printed" }), { name: "Lawn", slug: "lawn-2", order: 4, description: "Printed" });
});

test("the update body holds only what changed, and is empty when nothing did", () => {
  assert.deepEqual(toUpdateRequest(formFromCategory(category), category), {});
  assert.deepEqual(toUpdateRequest({ ...formFromCategory(category), order: "5" }, category), { order: 5 });
  assert.deepEqual(toUpdateRequest({ ...formFromCategory(category), name: "Lawn Suits", description: "Cool" }, category), { name: "Lawn Suits", description: "Cool" });
  assert.deepEqual(toUpdateRequest({ ...formFromCategory({ ...category, description: "Old" }), description: "  " }, { ...category, description: "Old" }), { description: null });
});

test("backend issues land on their fields, and others are dropped", () => {
  assert.deepEqual(issuesToErrors([{ path: "slug", message: "must use lowercase letters" }, { path: "body", message: "x" }]), { slug: "Must use lowercase letters." });
});
