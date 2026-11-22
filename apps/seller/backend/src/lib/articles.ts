import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import * as markdownNs from '@markaz/platform-kit/content-markdown';
import { unwrapCjs } from '@/lib/cjs';
import { ARTICLE_INVALID, ARTICLE_SLUG_MAX } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { slugFromText } from '@/lib/categories';
import { Media } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';

const markdown: typeof markdownNs = unwrapCjs(markdownNs);

/**
 * Sprint 7 (S7-B2, CO-116): what the article write routes share. Helpers live here, never in a route file.
 */

const invalid = (field: string, message: string): HttpError => new HttpError(400, message, ARTICLE_INVALID, field);

/**
 * The JSON body of a write, checked against a strict contract. A body that is not JSON, or that breaks the contract, is a 400 ARTICLE_INVALID that names
 * the field (the form marks it): the first field in error, or the unknown field the body carried.
 */
export async function parseArticleBody<T>(request: NextRequest, schema: ZodType<T, unknown>): Promise<T> {
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
  throw invalid(String(issue?.path[0] ?? 'body'), issue?.message ?? 'The article is not valid.');
}

/** A web address for the article from its title, or '' when the title has no Latin letter or digit (an Urdu title: the seller types one). */
export function articleSlugFromTitle(title: string): string {
  return slugFromText(title, ARTICLE_SLUG_MAX);
}

/** Articles written before Sprint 7 hold a rich-text object. Read as the plain paragraphs it was made of; text stays text. */
export function articleContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  const root = (content as { root?: { children?: Array<{ children?: Array<{ text?: unknown }> }> } } | null | undefined)?.root;
  if (!root || !Array.isArray(root.children)) return '';
  return root.children
    .map((node) => (Array.isArray(node.children) ? node.children.map((c) => (typeof c.text === 'string' ? c.text : '')).join('') : ''))
    .filter((text) => text !== '')
    .join('\n\n');
}

/** The article as the dashboard reads it: the wire form, the content as text, a revision, tags; the server-only media references are left out. */
export function articleToWire(doc: unknown, options: { withContent?: boolean } = {}): Record<string, unknown> {
  const wire = toWire(plainDoc(doc));
  const { mediaRefs: _mediaRefs, ...rest } = wire;
  void _mediaRefs;
  const out: Record<string, unknown> = {
    ...rest,
    tags: Array.isArray(rest.tags) ? rest.tags : [],
    revision: typeof rest.revision === 'number' ? rest.revision : 0,
  };
  if (options.withContent === false) delete out.content;
  else out.content = articleContentText(rest.content);
  return out;
}

export interface ArticleMedia {
  /** The cover as a media id, or null. */
  coverImage: string | null;
  /** Every media record the article uses: the cover and the images in the text. Ids, without repeats. */
  mediaRefs: string[];
}

/**
 * Resolves the pictures of an article against the store's own media library. The cover may be a media id or the https address of one of the store's
 * files; an image in the text must be the address of one of the store's files too (D-118: images come from the media library). Anything else is a 400
 * that names the field. `cover` undefined means the cover is not part of this write (the caller keeps the stored one and passes it as `keepCover`).
 */
export async function resolveArticleMedia(
  storeId: string,
  input: { cover: string | null | undefined; keepCover: string | null; content: string },
): Promise<ArticleMedia> {
  let coverImage: string | null = input.cover === undefined ? input.keepCover : input.cover;
  const inline = markdown.contentImageUrls(input.content);

  const urls: string[] = [...inline];
  const coverIsUrl = typeof input.cover === 'string' && !/^[0-9a-fA-F]{24}$/.test(input.cover);
  if (coverIsUrl) urls.push(input.cover as string);

  const byUrl = new Map<string, string>();
  if (urls.length > 0) {
    const rows = (await Media.find({ store: storeId, url: { $in: urls } }).select('url').lean()) as unknown as Array<{ _id: unknown; url?: unknown }>;
    for (const row of rows) if (typeof row.url === 'string') byUrl.set(row.url, String(row._id));
  }

  if (coverIsUrl) {
    const found = byUrl.get(input.cover as string);
    if (found === undefined) throw invalid('coverImage', 'Choose a picture from your media library.');
    coverImage = found;
  } else if (typeof input.cover === 'string') {
    const owned = await Media.findOne({ _id: input.cover, store: storeId }).select('_id').lean();
    if (!owned) throw invalid('coverImage', 'Choose a picture from your media library.');
    coverImage = String(input.cover);
  }

  const refs = new Set<string>();
  if (coverImage !== null) refs.add(coverImage);
  for (const url of inline) {
    const id = byUrl.get(url);
    if (id === undefined) throw invalid('content', 'An image in the text is not in your media library: ' + url.slice(0, 80));
    refs.add(id);
  }
  return { coverImage, mediaRefs: [...refs] };
}
