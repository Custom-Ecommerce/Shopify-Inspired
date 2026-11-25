import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTICLE_CONTENT_MAX,
  ARTICLE_TAGS_MAX,
  ARTICLE_WRITE_FIELDS,
  articleCreateSchema,
  articleUpdateSchema,
  storeArticleSchema,
} from '../src/store-article';

// Sprint 7 (S7-B2): the article write contracts. Strict, blog only, length limits, the first issue names the field.

const ID = '65a000000000000000000001';
const base = { title: 'Summer lookbook' };

const firstField = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string; keys?: string[] }> } }): string | undefined => {
  if (result.success) return undefined;
  const issue = result.error!.issues[0]!;
  return issue.code === 'unrecognized_keys' ? issue.keys![0] : String(issue.path[0]);
};

test('create: a title alone is enough; everything else has a default in the route', () => {
  assert.deepEqual(articleCreateSchema.parse(base), base);
  const full = articleCreateSchema.parse({
    type: 'blog',
    title: '  Summer lookbook ',
    slug: 'summer-lookbook',
    excerpt: ' Short ',
    content: '# Hi',
    coverImage: ID,
    status: 'published',
    tags: ['summer', 'lawn'],
    seoTitle: 'Summer',
    seoDescription: 'A look at summer',
  });
  assert.equal(full.title, 'Summer lookbook', 'text is trimmed');
  assert.equal(full.excerpt, 'Short');
});

test('create: blog only, draft or published only', () => {
  assert.equal(articleCreateSchema.safeParse({ ...base, type: 'blog' }).success, true);
  for (const type of ['lookbook', 'size_guide', 'care_instructions', 'news']) assert.equal(firstField(articleCreateSchema.safeParse({ ...base, type })), 'type', type);
  for (const status of ['draft', 'published']) assert.equal(articleCreateSchema.safeParse({ ...base, status }).success, true, status);
  for (const status of ['archived', 'DRAFT', '']) assert.equal(firstField(articleCreateSchema.safeParse({ ...base, status })), 'status', status);
});

test('create: the length limits, each naming its field', () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ title: 'ab' }, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(121) }, 'title'],
    [{ ...base, slug: 'x'.repeat(81) }, 'slug'],
    [{ ...base, excerpt: 'x'.repeat(161) }, 'excerpt'],
    [{ ...base, content: 'x'.repeat(ARTICLE_CONTENT_MAX + 1) }, 'content'],
    [{ ...base, seoTitle: 'x'.repeat(71) }, 'seoTitle'],
    [{ ...base, seoDescription: 'x'.repeat(161) }, 'seoDescription'],
    [{ ...base, tags: Array.from({ length: ARTICLE_TAGS_MAX + 1 }, (_, i) => 'tag' + i) }, 'tags'],
    [{ ...base, tags: ['x'.repeat(31)] }, 'tags'],
    [{ ...base, tags: [''] }, 'tags'],
    [{ ...base, tags: ['Eid', 'eid'] }, 'tags'],
  ];
  for (const [body, field] of bad) assert.equal(firstField(articleCreateSchema.safeParse(body)), field, JSON.stringify(body).slice(0, 60));
  assert.equal(articleCreateSchema.safeParse({ ...base, content: 'x'.repeat(ARTICLE_CONTENT_MAX) }).success, true, 'exactly the limit is fine');
  assert.equal(articleCreateSchema.safeParse({ ...base, tags: Array.from({ length: ARTICLE_TAGS_MAX }, (_, i) => 'tag' + i) }).success, true);
});

test('create: the slug is lowercase words with single dashes', () => {
  for (const slug of ['summer', 'summer-2026', 'a1-b2-c3']) assert.equal(articleCreateSchema.safeParse({ ...base, slug }).success, true, slug);
  for (const slug of ['Summer', 'summer lookbook', 'summer--lookbook', '-summer', 'summer-', 'summer_lookbook', '../etc', 'عید', '']) {
    assert.equal(firstField(articleCreateSchema.safeParse({ ...base, slug })), 'slug', slug);
  }
});

test('create: the cover is a media id or an https address, or null', () => {
  for (const coverImage of [ID, 'https://res.cloudinary.com/demo/image/upload/a.jpg', null]) assert.equal(articleCreateSchema.safeParse({ ...base, coverImage }).success, true, String(coverImage));
  for (const coverImage of ['http://cdn.test/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', 42, '/uploads/a.png']) {
    assert.equal(firstField(articleCreateSchema.safeParse({ ...base, coverImage })), 'coverImage', String(coverImage));
  }
});

test('create and update are strict: the store, the publish date, the revision (on create) and the media references are refused, never ignored', () => {
  for (const key of ['store', 'publishedAt', 'mediaRefs', 'createdAt', 'id', '_id', 'owner', 'author']) {
    assert.equal(firstField(articleCreateSchema.safeParse({ ...base, [key]: 'x' })), key, 'create ' + key);
    assert.equal(firstField(articleUpdateSchema.safeParse({ revision: 0, title: 'Fine title', [key]: 'x' })), key, 'update ' + key);
  }
  assert.equal(firstField(articleCreateSchema.safeParse({ ...base, revision: 0 })), 'revision');
});

test('update: the revision is required and is a whole number from 0; at least one field must change', () => {
  assert.equal(articleUpdateSchema.safeParse({ revision: 0, title: 'New title' }).success, true);
  assert.equal(articleUpdateSchema.safeParse({ revision: 12, status: 'published' }).success, true);
  for (const revision of [undefined, -1, 1.5, '1', null]) assert.equal(firstField(articleUpdateSchema.safeParse({ revision, title: 'New title' })), 'revision', String(revision));
  assert.equal(firstField(articleUpdateSchema.safeParse({ title: 'No revision' })), 'revision');
  assert.equal(firstField(articleUpdateSchema.safeParse({ revision: 0 })), 'revision', 'nothing to change');
  assert.equal(firstField(articleUpdateSchema.safeParse({})), 'revision');
});

test('update: the same field rules as create, and null clears the optional text and the cover', () => {
  assert.equal(articleUpdateSchema.safeParse({ revision: 1, excerpt: null, seoTitle: null, seoDescription: null, coverImage: null, tags: [] }).success, true);
  assert.equal(firstField(articleUpdateSchema.safeParse({ revision: 1, title: 'ab' })), 'title');
  assert.equal(firstField(articleUpdateSchema.safeParse({ revision: 1, status: 'archived' })), 'status');
  assert.equal(firstField(articleUpdateSchema.safeParse({ revision: 1, type: 'lookbook' })), 'type');
  assert.equal(firstField(articleUpdateSchema.safeParse({ revision: 1, content: 'x'.repeat(ARTICLE_CONTENT_MAX + 1) })), 'content');
  assert.equal(firstField(articleUpdateSchema.safeParse({ revision: 1, slug: 'Bad Slug' })), 'slug');
});

test('the write fields are the ones the schemas know (the policy row uses this list)', () => {
  assert.deepEqual([...ARTICLE_WRITE_FIELDS].sort(), Object.keys(articleCreateSchema.shape).sort());
  assert.deepEqual(Object.keys(articleUpdateSchema.shape).filter((k) => k !== 'revision').sort(), [...ARTICLE_WRITE_FIELDS].sort());
});

test('the read schema carries tags, the SEO fields and the revision, and still accepts a row from before them', () => {
  const row = { id: ID, store: ID, title: 'T', slug: 't', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
  assert.equal(storeArticleSchema.safeParse(row).success, true);
  assert.equal(storeArticleSchema.safeParse({ ...row, tags: ['a'], seoTitle: 'S', seoDescription: null, revision: 3, content: 'text' }).success, true);
  assert.equal(storeArticleSchema.safeParse({ ...row, content: { root: { children: [] } } }).success, true, 'older rich-text content is still readable');
  assert.equal(storeArticleSchema.safeParse({ ...row, revision: -1 }).success, false);
});
