import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** Article types and statuses, as apps/admin/src/collections/StoreArticles.ts defines them. Reading knows all of them; writing (Sprint 7) knows less. */
export const ARTICLE_TYPES = ['blog', 'lookbook', 'size_guide', 'care_instructions'] as const;
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;

/** Sprint 7 (S7-B2): what a seller can write. Blog only for now; archived is kept for older rows and is not a state a seller picks. */
export const ARTICLE_WRITE_TYPES = ['blog'] as const;
export const ARTICLE_WRITE_STATUSES = ['draft', 'published'] as const;

/** Length limits, one place for the form, the contracts and the tests. */
export const ARTICLE_TITLE_MAX = 120;
export const ARTICLE_SLUG_MAX = 80;
export const ARTICLE_EXCERPT_MAX = 160;
export const ARTICLE_CONTENT_MAX = 50000;
export const ARTICLE_TAGS_MAX = 10;
export const ARTICLE_TAG_MAX = 30;
export const ARTICLE_SEO_TITLE_MAX = 70;
export const ARTICLE_SEO_DESCRIPTION_MAX = 160;
export const ARTICLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Error codes of the article write routes. */
export const ARTICLE_INVALID = 'ARTICLE_INVALID';
export const ARTICLE_SLUG_TAKEN = 'ARTICLE_SLUG_TAKEN';
export const ARTICLE_REVISION_CONFLICT = 'ARTICLE_REVISION_CONFLICT';

const relation = z.union([
  objectIdSchema,
  z.object({ id: objectIdSchema, url: z.string().nullable().optional() }),
]);

/**
 * A store article as the dashboard reads it. Since Sprint 7 the content is text with a small Markdown subset (see @markaz/platform-kit/content-markdown);
 * older rows may still hold the earlier rich-text object, so it is read as unknown.
 */
export const storeArticleSchema = z.object({
  id: objectIdSchema,
  store: objectIdSchema,
  title: z.string().min(1),
  slug: z.string().min(1),
  excerpt: z.string().max(160).nullable().optional(),
  content: z.unknown().optional(),
  coverImage: relation.nullable().optional(),
  type: z.enum(ARTICLE_TYPES).nullable().optional(),
  status: z.enum(ARTICLE_STATUSES).nullable().optional(),
  tags: z.array(z.string()).optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  /** The version of the record: every write that changes it adds one. An update must name the revision it read. */
  revision: z.number().int().min(0).optional(),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

// ------------------------------------------------------------------------------------------------------------------------------------ writing

const optionalText = (max: number, tooLong: string) => z.string().trim().max(max, tooLong);

/** A cover image: a media id of the store, or the https address of one of the store's media. The backend checks the store. */
export const articleCoverImageSchema = z.union([
  objectIdSchema,
  z.string().trim().url('Choose a picture from your media library.').startsWith('https://', 'Choose a picture from your media library.'),
]);

const tagsSchema = z
  .array(z.string().trim().min(1, 'A tag cannot be empty.').max(ARTICLE_TAG_MAX, 'A tag can be at most 30 characters.'))
  .max(ARTICLE_TAGS_MAX, 'An article can have at most 10 tags.')
  .refine((tags) => new Set(tags.map((tag) => tag.toLowerCase())).size === tags.length, 'Each tag can be used once.');

const titleSchema = z.string().trim().min(3, 'The title needs at least 3 characters.').max(ARTICLE_TITLE_MAX, 'The title can be at most 120 characters.');
const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a web address for the article.')
  .max(ARTICLE_SLUG_MAX, 'The web address can be at most 80 characters.')
  .regex(ARTICLE_SLUG_PATTERN, 'Use lowercase letters, numbers and single dashes only.');

/** POST /api/storeArticles. Strict: a field that is not here (store, publishedAt, revision ...) is refused, never ignored. */
export const articleCreateSchema = z
  .object({
    type: z.enum(ARTICLE_WRITE_TYPES, 'Only blog articles can be written for now.').optional(),
    title: titleSchema,
    slug: slugSchema.optional(),
    excerpt: optionalText(ARTICLE_EXCERPT_MAX, 'The summary can be at most 160 characters.').nullable().optional(),
    content: z.string().max(ARTICLE_CONTENT_MAX, 'The article can be at most 50,000 characters.').optional(),
    coverImage: articleCoverImageSchema.nullable().optional(),
    status: z.enum(ARTICLE_WRITE_STATUSES, 'The status is draft or published.').optional(),
    tags: tagsSchema.optional(),
    seoTitle: optionalText(ARTICLE_SEO_TITLE_MAX, 'The search title can be at most 70 characters.').nullable().optional(),
    seoDescription: optionalText(ARTICLE_SEO_DESCRIPTION_MAX, 'The search description can be at most 160 characters.').nullable().optional(),
  })
  .strict();

/**
 * PATCH /api/storeArticles/:id. Changes only the fields sent; `revision` (the version the form read) is required, and is the compare-and-set: a save made
 * on an older version is a 409. Strict, like the create body.
 */
export const articleUpdateSchema = z
  .object({
    revision: z.number('Reload the article: its version is missing.').int('Reload the article: its version is missing.').min(0),
    type: z.enum(ARTICLE_WRITE_TYPES, 'Only blog articles can be written for now.').optional(),
    title: titleSchema.optional(),
    slug: slugSchema.optional(),
    excerpt: optionalText(ARTICLE_EXCERPT_MAX, 'The summary can be at most 160 characters.').nullable().optional(),
    content: z.string().max(ARTICLE_CONTENT_MAX, 'The article can be at most 50,000 characters.').optional(),
    coverImage: articleCoverImageSchema.nullable().optional(),
    status: z.enum(ARTICLE_WRITE_STATUSES, 'The status is draft or published.').optional(),
    tags: tagsSchema.optional(),
    seoTitle: optionalText(ARTICLE_SEO_TITLE_MAX, 'The search title can be at most 70 characters.').nullable().optional(),
    seoDescription: optionalText(ARTICLE_SEO_DESCRIPTION_MAX, 'The search description can be at most 160 characters.').nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), { message: 'Nothing to change.', path: ['revision'] });

/** The fields a seller may write, for the policy row and the routes. `revision` is the guard, not data. */
export const ARTICLE_WRITE_FIELDS = ['type', 'title', 'slug', 'excerpt', 'content', 'coverImage', 'status', 'tags', 'seoTitle', 'seoDescription'] as const;

export type StoreArticle = z.infer<typeof storeArticleSchema>;
export type ArticleCreate = z.infer<typeof articleCreateSchema>;
export type ArticleUpdate = z.infer<typeof articleUpdateSchema>;
