import {
  ADMIN_CATEGORY_DESCRIPTION_MAX,
  ADMIN_CATEGORY_NAME_MAX,
  ADMIN_CATEGORY_ORDER_MAX,
  ADMIN_CATEGORY_SLUG_MAX,
  ADMIN_CATEGORY_SLUG_PATTERN,
  type AdminCategory,
  type AdminCategoryCreateRequest,
  type AdminCategoryUpdateRequest,
} from "@/lib/contracts";
import { readPage, readSearch } from "@/lib/list-state";
import { PAGE_SIZE } from "@/lib/stores";

export interface CategoryListState {
  page: number;
  q: string;
}

export function parseCategoryState(params: { get(name: string): string | null }): CategoryListState {
  return { page: readPage(params), q: readSearch(params) };
}

/** The query string for a category list state. Defaults are left out; the backend call adds the page size. */
export function categoryStateToQuery(state: CategoryListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

/** A slug made from a name: accents removed, lowercase, anything else becomes a single hyphen. */
export function slugify(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ADMIN_CATEGORY_SLUG_MAX);
  return base.replace(/-+$/, "");
}

/** The form holds text for every field, so an input is never uncontrolled. */
export interface CategoryFormValues {
  name: string;
  slug: string;
  order: string;
  description: string;
}

export type CategoryFormField = keyof CategoryFormValues;
export type CategoryFormErrors = Partial<Record<CategoryFormField, string>>;
export type CategoryFormMode = "create" | "edit";

export const EMPTY_CATEGORY_FORM: CategoryFormValues = { name: "", slug: "", order: "0", description: "" };

export function formFromCategory(category: AdminCategory): CategoryFormValues {
  return { name: category.name, slug: category.slug, order: String(category.order), description: category.description ?? "" };
}

/** The same rules the backend enforces. A blank slug is allowed on create: it is made from the name. */
export function validateCategoryForm(values: CategoryFormValues, mode: CategoryFormMode): CategoryFormErrors {
  const errors: CategoryFormErrors = {};
  const name = values.name.trim();
  if (name === "") errors.name = "Enter a name.";
  else if (name.length > ADMIN_CATEGORY_NAME_MAX) errors.name = "The name can be at most " + ADMIN_CATEGORY_NAME_MAX + " characters.";

  const slug = values.slug.trim();
  if (slug === "") {
    if (mode === "edit") errors.slug = "Enter a slug.";
    else if (name !== "" && slugify(name) === "") errors.slug = "A slug could not be made from the name. Enter one.";
  } else if (slug.length > ADMIN_CATEGORY_SLUG_MAX) errors.slug = "The slug can be at most " + ADMIN_CATEGORY_SLUG_MAX + " characters.";
  else if (!ADMIN_CATEGORY_SLUG_PATTERN.test(slug)) errors.slug = "Use lowercase letters, numbers, and single hyphens.";

  const order = values.order.trim();
  if (order !== "" && (!/^\d{1,4}$/.test(order) || Number(order) > ADMIN_CATEGORY_ORDER_MAX)) {
    errors.order = "Enter a whole number from 0 to " + ADMIN_CATEGORY_ORDER_MAX + ".";
  }

  if (values.description.trim().length > ADMIN_CATEGORY_DESCRIPTION_MAX) {
    errors.description = "The description can be at most " + ADMIN_CATEGORY_DESCRIPTION_MAX + " characters.";
  }
  return errors;
}

function orderOf(values: CategoryFormValues): number {
  const order = values.order.trim();
  return order === "" ? 0 : Number(order);
}

/** The create body. A blank slug is left out, so the backend makes it from the name. */
export function toCreateRequest(values: CategoryFormValues): AdminCategoryCreateRequest {
  const slug = values.slug.trim();
  const description = values.description.trim();
  return {
    name: values.name.trim(),
    ...(slug !== "" ? { slug } : {}),
    order: orderOf(values),
    description: description === "" ? null : description,
  };
}

/** The update body: only what differs from the category as loaded. Empty when nothing changed. */
export function toUpdateRequest(values: CategoryFormValues, original: AdminCategory): AdminCategoryUpdateRequest {
  const request: AdminCategoryUpdateRequest = {};
  const name = values.name.trim();
  if (name !== original.name) request.name = name;
  const slug = values.slug.trim();
  if (slug !== original.slug) request.slug = slug;
  const order = orderOf(values);
  if (order !== original.order) request.order = order;
  const description = values.description.trim() === "" ? null : values.description.trim();
  if (description !== original.description) request.description = description;
  return request;
}

/** Maps the backend's validation issues onto the form fields. Issues about anything else are dropped. */
export function issuesToErrors(issues: Array<{ path: string; message: string }>): CategoryFormErrors {
  const errors: CategoryFormErrors = {};
  for (const issue of issues) {
    if (issue.path === "name" || issue.path === "slug" || issue.path === "order" || issue.path === "description") {
      errors[issue.path] = issue.message.charAt(0).toUpperCase() + issue.message.slice(1) + (issue.message.endsWith(".") ? "" : ".");
    }
  }
  return errors;
}
