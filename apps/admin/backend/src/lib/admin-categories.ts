import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
  MAX_SEARCH_LENGTH,
  escapeRegex,
  readInteger,
  toIso,
  type Doc,
  type Issue,
} from '@/lib/admin-stores';

/**
 * Pure helpers for the admin category endpoints: query parsing, the Mongo filter, request validation, and the wire
 * shape. No I/O. The limits are the same as ADMIN_CATEGORY_* in @markaz/contracts (admin-catalogue.ts); the console
 * checks them first and this module checks them again, because no route trusts the browser.
 */

export const CATEGORY_NAME_MAX = 80;
export const CATEGORY_SLUG_MAX = 80;
export const CATEGORY_DESCRIPTION_MAX = 500;
export const CATEGORY_ORDER_MAX = 9999;
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The fields an operator may write. Passed to the policy check, so a field added later is denied until declared. */
export const CATEGORY_FIELDS = ['name', 'slug', 'order', 'description'] as const;

export const SLUG_TAKEN_MESSAGE = 'Another category already uses that slug.';

export interface CategoryListQuery {
  page: number;
  limit: number;
  q: string | null;
}

export type ParsedCategoryQuery = { ok: true; query: CategoryListQuery } | { ok: false; issues: Issue[] };

export function parseCategoryQuery(params: URLSearchParams): ParsedCategoryQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const rawQ = (params.get('q') ?? '').trim();
  if (rawQ.length > MAX_SEARCH_LENGTH) issues.push({ path: 'q', message: 'must be at most ' + MAX_SEARCH_LENGTH + ' characters' });
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, q: rawQ === '' ? null : rawQ } };
}

/** The search text is escaped, so it is matched literally against the name and the slug, never as a pattern. */
export function buildCategoryFilter(query: CategoryListQuery): Doc {
  if (query.q === null) return {};
  const pattern = { $regex: escapeRegex(query.q), $options: 'i' };
  return { $or: [{ name: pattern }, { slug: pattern }] };
}

/** A slug made from a name: accents removed, lowercase, anything else becomes a single hyphen. */
export function slugify(text: string): string {
  const base = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CATEGORY_SLUG_MAX);
  return base.replace(/-+$/, '');
}

export interface CategoryFields {
  name: string;
  slug: string;
  order: number;
  description: string | null;
}

export type ParsedCategoryCreate = { ok: true; data: CategoryFields } | { ok: false; issues: Issue[] };
export type ParsedCategoryUpdate = { ok: true; data: Partial<CategoryFields> } | { ok: false; issues: Issue[] };

const WRITABLE = new Set<string>(CATEGORY_FIELDS);

interface ReadFields {
  fields: Partial<CategoryFields>;
  slugBlank: boolean;
  issues: Issue[];
}

/** Reads and checks whichever of the four fields are present. Unknown fields are refused, not ignored. */
function readFields(input: unknown): ReadFields {
  const issues: Issue[] = [];
  const fields: Partial<CategoryFields> = {};
  let slugBlank = false;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { fields, slugBlank, issues: [{ path: 'body', message: 'must be a JSON object' }] };
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!WRITABLE.has(key)) issues.push({ path: key, message: 'is not a category field' });
  }

  if ('name' in record) {
    const value = record.name;
    const name = typeof value === 'string' ? value.trim() : '';
    if (typeof value !== 'string' || name === '') issues.push({ path: 'name', message: 'must be text of 1 to ' + CATEGORY_NAME_MAX + ' characters' });
    else if (name.length > CATEGORY_NAME_MAX) issues.push({ path: 'name', message: 'must be at most ' + CATEGORY_NAME_MAX + ' characters' });
    else fields.name = name;
  }

  if ('slug' in record) {
    const value = record.slug;
    if (typeof value !== 'string') issues.push({ path: 'slug', message: 'must be text' });
    else if (value.trim() === '') slugBlank = true;
    else if (value.trim().length > CATEGORY_SLUG_MAX) issues.push({ path: 'slug', message: 'must be at most ' + CATEGORY_SLUG_MAX + ' characters' });
    else if (!CATEGORY_SLUG_PATTERN.test(value.trim())) issues.push({ path: 'slug', message: 'must use lowercase letters, numbers, and single hyphens' });
    else fields.slug = value.trim();
  }

  if ('order' in record) {
    const value = record.order;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > CATEGORY_ORDER_MAX) {
      issues.push({ path: 'order', message: 'must be a whole number from 0 to ' + CATEGORY_ORDER_MAX });
    } else fields.order = value;
  }

  if ('description' in record) {
    const value = record.description;
    if (value === null) fields.description = null;
    else if (typeof value !== 'string') issues.push({ path: 'description', message: 'must be text or null' });
    else if (value.trim().length > CATEGORY_DESCRIPTION_MAX) issues.push({ path: 'description', message: 'must be at most ' + CATEGORY_DESCRIPTION_MAX + ' characters' });
    else fields.description = value.trim() === '' ? null : value.trim();
  }

  return { fields, slugBlank, issues };
}

/** Create: the name is required; the slug is made from it when absent; the order defaults to 0. */
export function parseCategoryCreate(input: unknown): ParsedCategoryCreate {
  const { fields, slugBlank, issues } = readFields(input);
  if (fields.name === undefined && !issues.some((issue) => issue.path === 'name' || issue.path === 'body')) {
    issues.push({ path: 'name', message: 'is required' });
  }
  let slug = fields.slug;
  if (slug === undefined && (slugBlank || !issues.some((issue) => issue.path === 'slug'))) {
    slug = fields.name === undefined ? '' : slugify(fields.name);
    if (slug === '' && fields.name !== undefined) issues.push({ path: 'slug', message: 'could not be made from the name; enter a slug' });
  }
  if (issues.length > 0 || fields.name === undefined || slug === undefined) return { ok: false, issues };
  return { ok: true, data: { name: fields.name, slug, order: fields.order ?? 0, description: fields.description ?? null } };
}

/** Update: only the fields sent change, at least one must be sent, and a slug cannot be cleared. */
export function parseCategoryUpdate(input: unknown): ParsedCategoryUpdate {
  const { fields, slugBlank, issues } = readFields(input);
  if (slugBlank) issues.push({ path: 'slug', message: 'cannot be empty' });
  if (issues.length === 0 && Object.keys(fields).length === 0) issues.push({ path: 'body', message: 'change at least one field' });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: fields };
}

export function toCategoryRow(doc: Doc) {
  const order = typeof doc.order === 'number' && Number.isFinite(doc.order) ? doc.order : 0;
  return {
    id: String(doc._id),
    name: typeof doc.name === 'string' ? doc.name : '',
    slug: typeof doc.slug === 'string' ? doc.slug : '',
    order,
    description: typeof doc.description === 'string' ? doc.description : null,
    createdAt: toIso(doc.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(doc.updatedAt) ?? toIso(doc.createdAt) ?? new Date(0).toISOString(),
  };
}

/** What an audit entry keeps of a category: the writable fields, nothing else. */
export function categorySnapshot(doc: Doc): CategoryFields {
  return {
    name: typeof doc.name === 'string' ? doc.name : '',
    slug: typeof doc.slug === 'string' ? doc.slug : '',
    order: typeof doc.order === 'number' && Number.isFinite(doc.order) ? doc.order : 0,
    description: typeof doc.description === 'string' ? doc.description : null,
  };
}

/** A MongoDB duplicate key error: the unique slug index refused the write. */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}
