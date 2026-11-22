/**
 * Sprint 7 (S7-B2): the blog's types and rules on the dashboard side, as pure functions (the list URL, the form, the payload, the failure messages).
 * The limits mirror packages/contracts/src/store-article.ts; the test compares them, so they cannot drift.
 */

export const ARTICLE_LIMITS = {
  title: { min: 3, max: 120 },
  slug: 80,
  excerpt: 160,
  content: 50000,
  tags: 10,
  tag: 30,
  seoTitle: 70,
  seoDescription: 160,
} as const;

export type ArticleStatus = "draft" | "published";

/** What the list shows (the backend leaves the text out of the list). */
export interface ArticleListItem {
  id: string;
  title: string;
  slug: string;
  status: string;
  type?: string;
  tags?: string[];
  publishedAt?: string | null;
  updatedAt?: string;
  revision?: number;
}

/** One article for the form. `coverImage` is a media id, or an object with an id and url (older reads). */
export interface ArticleDetail extends ArticleListItem {
  excerpt?: string | null;
  content?: string;
  coverImage?: string | { id: string; url?: string | null } | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export const ARTICLE_STATUS_FILTERS: ReadonlyArray<{ value: "" | ArticleStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
];

export function articleStatusLabel(status: string): string {
  return status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft";
}

/** The dashboard's own list route, with the filter and the search. An empty value is left out. */
export function articleListUrl(options: { status?: string; q?: string; page?: number; limit?: number } = {}): string {
  const params = new URLSearchParams();
  if (options.status === "draft" || options.status === "published") params.set("status", options.status);
  const q = (options.q ?? "").trim().slice(0, 80);
  if (q !== "") params.set("q", q);
  if (options.page !== undefined && options.page > 1) params.set("page", String(options.page));
  params.set("limit", String(options.limit ?? 50));
  return "/api/dashboard/storeArticles?" + params.toString();
}

/** A web address from a title: lowercase Latin letters and digits with single dashes. Empty for a title with none (an Urdu title). */
export function articleSlugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ARTICLE_LIMITS.slug)
    .replace(/-+$/g, "");
}

/** "eid, lawn ,Eid" gives ["eid", "lawn"]: trimmed, empty ones dropped, a repeat (any case) dropped. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const tag = part.trim();
    if (tag === "" || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

export interface ArticleFormValues {
  title: string;
  slug: string;
  slugEdited: boolean;
  excerpt: string;
  content: string;
  /** A media id, or null. */
  coverImage: string | null;
  status: ArticleStatus;
  tagsText: string;
  seoTitle: string;
  seoDescription: string;
}

export function emptyArticleForm(): ArticleFormValues {
  return { title: "", slug: "", slugEdited: false, excerpt: "", content: "", coverImage: null, status: "draft", tagsText: "", seoTitle: "", seoDescription: "" };
}

export function coverImageId(cover: ArticleDetail["coverImage"]): string | null {
  if (cover === null || cover === undefined) return null;
  return typeof cover === "string" ? cover : cover.id;
}

export function articleToForm(article: ArticleDetail): ArticleFormValues {
  return {
    title: article.title,
    slug: article.slug,
    slugEdited: true,
    excerpt: article.excerpt ?? "",
    content: typeof article.content === "string" ? article.content : "",
    coverImage: coverImageId(article.coverImage),
    status: article.status === "published" ? "published" : "draft",
    tagsText: (article.tags ?? []).join(", "),
    seoTitle: article.seoTitle ?? "",
    seoDescription: article.seoDescription ?? "",
  };
}

/** The slug the form will send: the typed one, else the one from the title. */
export function effectiveSlug(values: Pick<ArticleFormValues, "title" | "slug" | "slugEdited">): string {
  return values.slugEdited ? values.slug : articleSlugify(values.title);
}

/** Problems the form can see before it sends anything, by field name (the names the backend uses). */
export function articleFormProblems(values: ArticleFormValues): Record<string, string> {
  const problems: Record<string, string> = {};
  const title = values.title.trim();
  if (title.length < ARTICLE_LIMITS.title.min) problems.title = `The title needs at least ${ARTICLE_LIMITS.title.min} characters.`;
  else if (title.length > ARTICLE_LIMITS.title.max) problems.title = `The title can be at most ${ARTICLE_LIMITS.title.max} characters.`;
  const slug = effectiveSlug(values);
  if (slug === "") problems.slug = "Enter a web address (letters and numbers) for the article.";
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) problems.slug = "Use lowercase letters, numbers and single dashes only.";
  else if (slug.length > ARTICLE_LIMITS.slug) problems.slug = `The web address can be at most ${ARTICLE_LIMITS.slug} characters.`;
  if (values.excerpt.trim().length > ARTICLE_LIMITS.excerpt) problems.excerpt = `The summary can be at most ${ARTICLE_LIMITS.excerpt} characters.`;
  if (values.content.length > ARTICLE_LIMITS.content) problems.content = "The article can be at most 50,000 characters.";
  const tags = parseTags(values.tagsText);
  if (tags.length > ARTICLE_LIMITS.tags) problems.tags = `An article can have at most ${ARTICLE_LIMITS.tags} tags.`;
  else if (tags.some((tag) => tag.length > ARTICLE_LIMITS.tag)) problems.tags = `A tag can be at most ${ARTICLE_LIMITS.tag} characters.`;
  if (values.seoTitle.trim().length > ARTICLE_LIMITS.seoTitle) problems.seoTitle = `The search title can be at most ${ARTICLE_LIMITS.seoTitle} characters.`;
  if (values.seoDescription.trim().length > ARTICLE_LIMITS.seoDescription) problems.seoDescription = `The search description can be at most ${ARTICLE_LIMITS.seoDescription} characters.`;
  return problems;
}

/**
 * The body of a save. Create sends everything the form holds; update sends everything too, plus the `revision` the form read (the backend compares it).
 * It never sends the store, the publish date or the type: the backend sets them, and its contract refuses them.
 */
export function articleFormToPayload(values: ArticleFormValues, revision?: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: values.title.trim(),
    slug: effectiveSlug(values),
    excerpt: values.excerpt.trim() === "" ? null : values.excerpt.trim(),
    content: values.content,
    coverImage: values.coverImage,
    status: values.status,
    tags: parseTags(values.tagsText),
    seoTitle: values.seoTitle.trim() === "" ? null : values.seoTitle.trim(),
    seoDescription: values.seoDescription.trim() === "" ? null : values.seoDescription.trim(),
  };
  if (revision !== undefined) payload.revision = revision;
  return payload;
}

export interface ArticleFailure {
  message: string;
  /** The form field the failure is about, when it names one. */
  field?: string;
  /** The article was changed somewhere else since it was loaded. */
  revisionConflict?: boolean;
  /** Another article of the store has this web address. */
  slugTaken?: boolean;
}

/** Reads a refused save (the BFF's `{ error, code, field }`) into what the form shows. */
export function readArticleFailure(status: number, body: unknown, fallback = "Could not save this article."): ArticleFailure {
  const rec = (body ?? {}) as { error?: unknown; code?: unknown; field?: unknown; details?: unknown };
  const first = Array.isArray(rec.details) ? (rec.details[0] as { message?: unknown } | undefined) : undefined;
  const message = typeof rec.error === "string" ? rec.error : typeof first?.message === "string" ? first.message : fallback;
  const field = typeof rec.field === "string" ? rec.field : undefined;
  return {
    message,
    ...(field === undefined ? {} : { field }),
    ...(rec.code === "ARTICLE_REVISION_CONFLICT" || (status === 409 && field === "revision") ? { revisionConflict: true } : {}),
    ...(rec.code === "ARTICLE_SLUG_TAKEN" ? { slugTaken: true } : {}),
  };
}

export function formatArticleDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The reading text under a markdown image: inserts `![alt](url)` on its own line after the cursor. */
export function insertImageMarkdown(content: string, cursor: number, alt: string, url: string): { content: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, content.length));
  const safeAlt = alt.replace(/[\r\n[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const snippet = `${at > 0 && content[at - 1] !== "\n" ? "\n\n" : ""}![${safeAlt}](${url})\n\n`;
  return { content: content.slice(0, at) + snippet + content.slice(at), cursor: at + snippet.length };
}
