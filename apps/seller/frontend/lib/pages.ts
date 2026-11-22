import { countPlaceholders, hasPlaceholder } from "@markaz/platform-kit/page-templates";
import { articleSlugify } from "@/lib/articles";

/**
 * Sprint 7 (S7-B3): the pages manager's types and rules on the dashboard side, as pure functions (the form, the payload, the failure messages, the
 * placeholder warning and the publish confirmation). The limits mirror packages/contracts/src/store-page.ts; the test compares them.
 */

export const PAGE_LIMITS = { title: { min: 2, max: 120 }, slug: 80, body: 50000, sortOrder: 9999 } as const;

/** Words the store itself uses for addresses; a page cannot take them (the backend refuses them too, with PAGE_SLUG_RESERVED). */
export const RESERVED_PAGE_SLUGS = ["products", "cart", "checkout", "track", "favourites", "search", "collections", "blog", "pages", "account", "api", "orders", "feedback"] as const;

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug.trim().toLowerCase());
}

export type PageStatus = "draft" | "published";

/** A page in the list (the backend leaves the text out of the list). */
export interface PageListItem {
  id: string;
  title: string;
  slug: string;
  status: string;
  showInFooter: boolean;
  sortOrder: number;
  revision?: number;
  publishedAt?: string | null;
  updatedAt?: string;
  hasPlaceholder?: boolean;
  template?: string | null;
}

export interface PageDetail extends PageListItem {
  body: string;
}

/** A default page template the manager offers. `exists` is true once the store has a page at that address. */
export interface PageTemplateItem {
  key: string;
  slug: string;
  title: string;
  legal: boolean;
  showInFooter: boolean;
  exists: boolean;
}

export interface PageListAnswer {
  pages: PageListItem[];
  templates: PageTemplateItem[];
}

/** Reads GET /api/dashboard/storePages. Null when the answer is not what the manager expects. */
export function readPageList(body: unknown): PageListAnswer | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as { docs?: unknown; templates?: unknown };
  if (!Array.isArray(rec.docs) || !Array.isArray(rec.templates)) return null;
  const pages = rec.docs.filter((d): d is PageListItem => typeof (d as PageListItem)?.id === "string" && typeof (d as PageListItem)?.slug === "string");
  const templates = rec.templates.filter((t): t is PageTemplateItem => typeof (t as PageTemplateItem)?.key === "string" && typeof (t as PageTemplateItem)?.slug === "string");
  return { pages, templates };
}

export function pageStatusLabel(status: string): string {
  return status === "published" ? "Published" : "Draft";
}

export interface PageFormValues {
  title: string;
  slug: string;
  slugEdited: boolean;
  body: string;
  status: PageStatus;
  showInFooter: boolean;
  /** Text in the input; a whole number from 0. */
  sortOrderText: string;
}

export function emptyPageForm(): PageFormValues {
  return { title: "", slug: "", slugEdited: false, body: "", status: "draft", showInFooter: false, sortOrderText: "0" };
}

export function pageToForm(page: PageDetail): PageFormValues {
  return {
    title: page.title,
    slug: page.slug,
    slugEdited: true,
    body: typeof page.body === "string" ? page.body : "",
    status: page.status === "published" ? "published" : "draft",
    showInFooter: page.showInFooter === true,
    sortOrderText: String(typeof page.sortOrder === "number" ? page.sortOrder : 0),
  };
}

export function effectivePageSlug(values: Pick<PageFormValues, "title" | "slug" | "slugEdited">): string {
  return values.slugEdited ? values.slug : articleSlugify(values.title);
}

/** The sort order as a number, or null when the text is not a whole number from 0 to 9999. */
export function parseSortOrder(text: string): number | null {
  const value = text.trim() === "" ? 0 : Number(text);
  return Number.isInteger(value) && value >= 0 && value <= PAGE_LIMITS.sortOrder ? value : null;
}

/** Problems the form can see before it sends anything, by field name (the names the backend uses). */
export function pageFormProblems(values: PageFormValues): Record<string, string> {
  const problems: Record<string, string> = {};
  const title = values.title.trim();
  if (title.length < PAGE_LIMITS.title.min) problems.title = `The title needs at least ${PAGE_LIMITS.title.min} characters.`;
  else if (title.length > PAGE_LIMITS.title.max) problems.title = `The title can be at most ${PAGE_LIMITS.title.max} characters.`;
  const slug = effectivePageSlug(values);
  if (slug === "") problems.slug = "Enter a web address (letters and numbers) for the page.";
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) problems.slug = "Use lowercase letters, numbers and single dashes only.";
  else if (slug.length > PAGE_LIMITS.slug) problems.slug = `The web address can be at most ${PAGE_LIMITS.slug} characters.`;
  else if (isReservedSlug(slug)) problems.slug = `"${slug}" is used by the store itself. Choose another web address.`;
  if (values.body.length > PAGE_LIMITS.body) problems.body = "The page can be at most 50,000 characters.";
  if (parseSortOrder(values.sortOrderText) === null) problems.sortOrder = "The order is a whole number from 0 to 9999.";
  return problems;
}

/** The body of a save. Update adds the `revision` the form read (the backend compares it). Never the store, the template or the publish date. */
export function pageFormToPayload(values: PageFormValues, revision?: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: values.title.trim(),
    slug: effectivePageSlug(values),
    body: values.body,
    status: values.status,
    showInFooter: values.showInFooter,
    sortOrder: parseSortOrder(values.sortOrderText) ?? 0,
  };
  if (revision !== undefined) payload.revision = revision;
  return payload;
}

// ----------------------------------------------------------------------------------------------------------------- placeholders and publishing

/** Whether the text still holds a `[[EDIT: ...]]` placeholder. */
export function textHasPlaceholder(text: string): boolean {
  return hasPlaceholder(text);
}

/** The warning shown while a placeholder is in the text, or null. */
export function placeholderWarning(text: string): string | null {
  const count = countPlaceholders(text);
  if (count === 0) return null;
  return count === 1
    ? "This page still has 1 placeholder in double square brackets, like [[EDIT: ...]]. Replace it with your own words before you publish, or shoppers will see it."
    : `This page still has ${count} placeholders in double square brackets, like [[EDIT: ...]]. Replace them with your own words before you publish, or shoppers will see them.`;
}

/**
 * Whether publishing this form needs a confirmation: only when the page is being published (not saved as a draft) and a placeholder is still in the text.
 * `wasPublished` is whether the stored page is already live: a live page saved again is "publishing" its change too.
 */
export function publishNeedsConfirmation(values: Pick<PageFormValues, "status" | "body">): boolean {
  return values.status === "published" && hasPlaceholder(values.body);
}

export function publishConfirmationMessage(body: string): string {
  const count = countPlaceholders(body);
  return `${count === 1 ? "1 placeholder is" : count + " placeholders are"} still in this page. Shoppers will see ${count === 1 ? "it" : "them"} word for word. Publish anyway?`;
}

// ------------------------------------------------------------------------------------------------------------------------- failures and calls

export interface PageFailure {
  message: string;
  field?: string;
  revisionConflict?: boolean;
  slugTaken?: boolean;
  slugReserved?: boolean;
}

/** Reads a refused save (the BFF's `{ error, code, field }`) into what the form shows. */
export function readPageFailure(status: number, body: unknown, fallback = "Could not save this page."): PageFailure {
  const rec = (body ?? {}) as { error?: unknown; code?: unknown; field?: unknown; details?: unknown };
  const first = Array.isArray(rec.details) ? (rec.details[0] as { message?: unknown } | undefined) : undefined;
  const message = typeof rec.error === "string" ? rec.error : typeof first?.message === "string" ? first.message : fallback;
  const field = typeof rec.field === "string" ? rec.field : undefined;
  return {
    message,
    ...(field === undefined ? {} : { field }),
    ...(rec.code === "PAGE_REVISION_CONFLICT" || (status === 409 && field === "revision") ? { revisionConflict: true } : {}),
    ...(rec.code === "PAGE_SLUG_TAKEN" ? { slugTaken: true } : {}),
    ...(rec.code === "PAGE_SLUG_RESERVED" ? { slugReserved: true } : {}),
  };
}

type StoreFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type PageCallResult<T> = { ok: true; value: T } | { ok: false; failure: PageFailure; status: number };

const NETWORK: PageFailure = { message: "Could not reach the backend. Please try again." };

async function failed(res: Response, fallback: string): Promise<{ ok: false; failure: PageFailure; status: number }> {
  return { ok: false, failure: readPageFailure(res.status, await res.json().catch(() => null), fallback), status: res.status };
}

/** The pages and the templates. Reading this creates nothing on the server. */
export async function fetchPages(storeFetch: StoreFetch): Promise<PageCallResult<PageListAnswer>> {
  try {
    const res = await storeFetch("/api/dashboard/storePages", { cache: "no-store" });
    if (!res.ok) return await failed(res, "Could not load your pages.");
    const answer = readPageList(await res.json().catch(() => null));
    return answer === null ? { ok: false, failure: { message: "Could not load your pages." }, status: res.status } : { ok: true, value: answer };
  } catch {
    return { ok: false, failure: NETWORK, status: 0 };
  }
}

/** Creates ONE default page from its template (a draft). The only way a default page comes to exist. */
export async function createPageFromTemplate(storeFetch: StoreFetch, template: string): Promise<PageCallResult<PageDetail>> {
  try {
    const res = await storeFetch("/api/dashboard/storePages/from-template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template }),
    });
    if (!res.ok) return await failed(res, "Could not create this page.");
    return { ok: true, value: (await res.json()) as PageDetail };
  } catch {
    return { ok: false, failure: NETWORK, status: 0 };
  }
}
