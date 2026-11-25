import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Sprint 7 (S7-B3): the static pages of a store (about, contact, shipping, returns, privacy, or one the seller writes). Strict, like the article
 * contracts: a field that is not listed (store, revision on create, mediaRefs, publishedAt) is refused, never ignored.
 */

export const PAGE_STATUSES = ['draft', 'published'] as const;
export const PAGE_TITLE_MAX = 120;
export const PAGE_SLUG_MAX = 80;
export const PAGE_BODY_MAX = 50000;
export const PAGE_SORT_MAX = 9999;
export const PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Slugs a store page may not use: the storefront's own routes and the words a shopper expects to find elsewhere. A page lives at /pages/<slug>, so this
 * is not a routing clash today; it keeps the web address unambiguous if a page is ever served at the top level.
 */
export const PAGE_RESERVED_SLUGS = ['products', 'cart', 'checkout', 'track', 'favourites', 'search', 'collections', 'blog', 'pages', 'account', 'api', 'orders', 'feedback'] as const;

export function isReservedPageSlug(slug: string): boolean {
  return (PAGE_RESERVED_SLUGS as readonly string[]).includes(slug.trim().toLowerCase());
}

/** Error codes of the page routes. */
export const PAGE_INVALID = 'PAGE_INVALID';
export const PAGE_SLUG_TAKEN = 'PAGE_SLUG_TAKEN';
export const PAGE_SLUG_RESERVED = 'PAGE_SLUG_RESERVED';
export const PAGE_REVISION_CONFLICT = 'PAGE_REVISION_CONFLICT';
export const PAGE_TEMPLATE_UNKNOWN = 'PAGE_TEMPLATE_UNKNOWN';

const titleSchema = z.string().trim().min(2, 'The title needs at least 2 characters.').max(PAGE_TITLE_MAX, 'The title can be at most 120 characters.');
const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a web address for the page.')
  .max(PAGE_SLUG_MAX, 'The web address can be at most 80 characters.')
  .regex(PAGE_SLUG_PATTERN, 'Use lowercase letters, numbers and single dashes only.');
const bodySchema = z.string().max(PAGE_BODY_MAX, 'The page can be at most 50,000 characters.');
const statusSchema = z.enum(PAGE_STATUSES, 'The status is draft or published.');
const sortSchema = z.number('The order is a whole number.').int('The order is a whole number.').min(0, 'The order cannot be below 0.').max(PAGE_SORT_MAX, 'The order can be at most 9999.');

/** POST /api/storePages: a page the seller writes from scratch. */
export const pageCreateSchema = z
  .object({
    title: titleSchema,
    slug: slugSchema.optional(),
    body: bodySchema.optional(),
    status: statusSchema.optional(),
    showInFooter: z.boolean('Say whether the footer links to this page.').optional(),
    sortOrder: sortSchema.optional(),
  })
  .strict();

/** POST /api/storePages/from-template: the template's key, nothing else. The text is copied from the platform's editable template. */
export const pageFromTemplateSchema = z.object({ template: z.string('Choose a template.').trim().min(1, 'Choose a template.').max(40) }).strict();

/** PATCH /api/storePages/:id. Changes only the fields sent; `revision` (the version the form read) is required and is the compare-and-set. */
export const pageUpdateSchema = z
  .object({
    revision: z.number('Reload the page: its version is missing.').int('Reload the page: its version is missing.').min(0),
    title: titleSchema.optional(),
    slug: slugSchema.optional(),
    body: bodySchema.optional(),
    status: statusSchema.optional(),
    showInFooter: z.boolean('Say whether the footer links to this page.').optional(),
    sortOrder: sortSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), { message: 'Nothing to change.', path: ['revision'] });

/** The fields a seller may write (the policy row uses this list). `revision` is the guard, not data. */
export const PAGE_WRITE_FIELDS = ['title', 'slug', 'body', 'status', 'showInFooter', 'sortOrder'] as const;

/** A page as the dashboard reads it. */
export const storePageSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  title: z.string().min(1),
  slug: z.string().min(1),
  body: z.string(),
  status: z.enum(PAGE_STATUSES),
  showInFooter: z.boolean(),
  sortOrder: z.number().int().min(0),
  revision: z.number().int().min(0),
  template: z.string().nullable().optional(),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type PageCreate = z.infer<typeof pageCreateSchema>;
export type PageUpdate = z.infer<typeof pageUpdateSchema>;
export type StorePage = z.infer<typeof storePageSchema>;
