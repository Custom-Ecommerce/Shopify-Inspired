import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import * as markdownNs from '@markaz/platform-kit/content-markdown';
import * as templatesNs from '@markaz/platform-kit/page-templates';
import { unwrapCjs } from '@/lib/cjs';
import { PAGE_INVALID, PAGE_SLUG_RESERVED, isReservedPageSlug } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { Media } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';

const markdown: typeof markdownNs = unwrapCjs(markdownNs);
const templates: typeof templatesNs = unwrapCjs(templatesNs);

/**
 * Sprint 7 (S7-B3): what the static page routes share. Helpers live here, never in a route file.
 */

const invalid = (field: string, message: string): HttpError => new HttpError(400, message, PAGE_INVALID, field);

/** The JSON body of a write, checked against a strict contract. A 400 PAGE_INVALID names the field (the form marks it). */
export async function parsePageBody<T>(request: NextRequest, schema: ZodType<T, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw invalid('body', 'Body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  if (issue?.code === 'unrecognized_keys') {
    const key = String(issue.keys[0] ?? 'body');
    throw invalid(key, 'The field ' + key + ' cannot be set here.');
  }
  throw invalid(String(issue?.path[0] ?? 'body'), issue?.message ?? 'The page is not valid.');
}

/** A reserved word (products, cart, blog ...) cannot be the web address of a page: 400 PAGE_SLUG_RESERVED, field slug. */
export function assertPageSlugAllowed(slug: string): void {
  if (isReservedPageSlug(slug)) throw new HttpError(400, 'The web address "' + slug + '" is used by the store itself. Choose another.', PAGE_SLUG_RESERVED, 'slug');
}

/** The page as the dashboard reads it: the wire form without the server-only references, and whether a placeholder is still in the text. */
export function pageToWire(doc: unknown, options: { withBody?: boolean } = {}): Record<string, unknown> {
  const wire = toWire(plainDoc(doc));
  const { mediaRefs: _mediaRefs, ...rest } = wire;
  void _mediaRefs;
  const body = typeof rest.body === 'string' ? rest.body : '';
  const out: Record<string, unknown> = {
    ...rest,
    body,
    revision: typeof rest.revision === 'number' ? rest.revision : 0,
    sortOrder: typeof rest.sortOrder === 'number' ? rest.sortOrder : 0,
    showInFooter: rest.showInFooter === true,
    hasPlaceholder: templates.hasPlaceholder(body),
  };
  if (options.withBody === false) delete out.body;
  return out;
}

/**
 * The templates the pages manager offers, with whether the store already has a page at that address. Reading this creates nothing: a page is made only when
 * the seller asks for it (POST /api/storePages/from-template).
 */
export function templateCatalog(existingSlugs: Iterable<string>): Array<{ key: string; slug: string; title: string; legal: boolean; showInFooter: boolean; exists: boolean }> {
  const have = new Set(existingSlugs);
  return templates.PAGE_TEMPLATES.map((template) => ({
    key: template.key,
    slug: template.slug,
    title: template.title,
    legal: template.legal,
    showInFooter: template.showInFooter,
    exists: have.has(template.slug),
  }));
}

/**
 * The media records the body of a page uses, as ids, resolved against the store's own library. An image in the text must be the address of one of the
 * store's files (D-118): anything else is a 400 on the body.
 */
export async function resolvePageMedia(storeId: string, body: string): Promise<string[]> {
  const urls = markdown.contentImageUrls(body);
  if (urls.length === 0) return [];
  const rows = (await Media.find({ store: storeId, url: { $in: urls } }).select('url').lean()) as unknown as Array<{ _id: unknown; url?: unknown }>;
  const byUrl = new Map<string, string>();
  for (const row of rows) if (typeof row.url === 'string') byUrl.set(row.url, String(row._id));
  const refs = new Set<string>();
  for (const url of urls) {
    const id = byUrl.get(url);
    if (id === undefined) throw invalid('body', 'An image in the text is not in your media library: ' + url.slice(0, 80));
    refs.add(id);
  }
  return [...refs];
}
