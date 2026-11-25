import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_BODY_MAX,
  PAGE_RESERVED_SLUGS,
  PAGE_WRITE_FIELDS,
  isReservedPageSlug,
  pageCreateSchema,
  pageFromTemplateSchema,
  pageUpdateSchema,
  storePageSchema,
} from '../src/store-page';

// Sprint 7 (S7-B3): the store page contracts. Strict, length limits, reserved slugs, the first issue names the field.

const ID = '65a000000000000000000001';

const firstField = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string; keys?: string[] }> } }): string | undefined => {
  if (result.success) return undefined;
  const issue = result.error!.issues[0]!;
  return issue.code === 'unrecognized_keys' ? issue.keys![0] : String(issue.path[0]);
};

test('create: a title is enough; the rest has a default in the route', () => {
  assert.deepEqual(pageCreateSchema.parse({ title: 'Size guide' }), { title: 'Size guide' });
  const full = pageCreateSchema.parse({ title: '  Size guide ', slug: 'size-guide', body: '# Sizes', status: 'published', showInFooter: true, sortOrder: 3 });
  assert.equal(full.title, 'Size guide');
  assert.equal(full.sortOrder, 3);
});

test('create: the limits, each naming its field', () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{}, 'title'],
    [{ title: 'a' }, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(121) }, 'title'],
    [{ title: 'Fine', slug: 'Bad Slug' }, 'slug'],
    [{ title: 'Fine', slug: 'x'.repeat(81) }, 'slug'],
    [{ title: 'Fine', slug: '' }, 'slug'],
    [{ title: 'Fine', body: 'x'.repeat(PAGE_BODY_MAX + 1) }, 'body'],
    [{ title: 'Fine', status: 'archived' }, 'status'],
    [{ title: 'Fine', showInFooter: 'yes' }, 'showInFooter'],
    [{ title: 'Fine', sortOrder: -1 }, 'sortOrder'],
    [{ title: 'Fine', sortOrder: 10000 }, 'sortOrder'],
    [{ title: 'Fine', sortOrder: 1.5 }, 'sortOrder'],
    [{ title: 'Fine', sortOrder: '2' }, 'sortOrder'],
  ];
  for (const [body, field] of bad) assert.equal(firstField(pageCreateSchema.safeParse(body)), field, JSON.stringify(body).slice(0, 60));
  assert.equal(pageCreateSchema.safeParse({ title: 'Fine', body: 'x'.repeat(PAGE_BODY_MAX) }).success, true, 'exactly the limit is fine');
});

test('create, update and from-template are strict: store, revision (on create), mediaRefs, publishedAt and anything else are refused', () => {
  for (const key of ['store', 'mediaRefs', 'publishedAt', 'createdAt', 'id', '_id', 'template', 'owner']) {
    assert.equal(firstField(pageCreateSchema.safeParse({ title: 'Fine', [key]: 'x' })), key, 'create ' + key);
    assert.equal(firstField(pageUpdateSchema.safeParse({ revision: 0, title: 'Fine', [key]: 'x' })), key, 'update ' + key);
  }
  assert.equal(firstField(pageCreateSchema.safeParse({ title: 'Fine', revision: 0 })), 'revision');
  assert.equal(firstField(pageFromTemplateSchema.safeParse({ template: 'about', store: ID })), 'store');
  assert.equal(firstField(pageFromTemplateSchema.safeParse({ template: 'about', title: 'Mine' })), 'title');
});

test('from-template: only the key; an empty or missing one is refused (an unknown key is the route\'s 422)', () => {
  assert.deepEqual(pageFromTemplateSchema.parse({ template: ' about ' }), { template: 'about' });
  for (const body of [{}, { template: '' }, { template: '   ' }, { template: 5 }, { template: 'x'.repeat(41) }]) assert.equal(firstField(pageFromTemplateSchema.safeParse(body)), 'template', JSON.stringify(body));
});

test('update: the revision is required and a whole number from 0; at least one field must change', () => {
  assert.equal(pageUpdateSchema.safeParse({ revision: 0, title: 'New title' }).success, true);
  assert.equal(pageUpdateSchema.safeParse({ revision: 5, status: 'published', showInFooter: false }).success, true);
  for (const revision of [undefined, -1, 1.5, '1', null]) assert.equal(firstField(pageUpdateSchema.safeParse({ revision, title: 'New title' })), 'revision', String(revision));
  assert.equal(firstField(pageUpdateSchema.safeParse({ title: 'No revision' })), 'revision');
  assert.equal(firstField(pageUpdateSchema.safeParse({ revision: 0 })), 'revision', 'nothing to change');
  assert.equal(firstField(pageUpdateSchema.safeParse({ revision: 0, title: 'x' })), 'title');
  assert.equal(firstField(pageUpdateSchema.safeParse({ revision: 0, sortOrder: 99999 })), 'sortOrder');
});

test('the reserved slugs, in any case and spacing', () => {
  assert.deepEqual(
    ['products', 'cart', 'checkout', 'track', 'favourites', 'search', 'collections', 'blog', 'pages', 'account', 'api'].filter((slug) => !(PAGE_RESERVED_SLUGS as readonly string[]).includes(slug)),
    [],
    'every word the task names is reserved',
  );
  for (const slug of PAGE_RESERVED_SLUGS) {
    assert.equal(isReservedPageSlug(slug), true, slug);
    assert.equal(isReservedPageSlug(' ' + slug.toUpperCase() + ' '), true, slug + ' upper');
  }
  for (const slug of ['about', 'contact', 'shipping', 'returns', 'privacy', 'blogging', 'products-faq', 'my-cart']) assert.equal(isReservedPageSlug(slug), false, slug);
  for (const slug of PAGE_RESERVED_SLUGS) assert.equal(pageCreateSchema.safeParse({ title: 'Fine', slug }).success, true, 'the schema leaves reserved words to the route, which names the code');
});

test('the write fields are the ones the schemas know (the policy row uses this list)', () => {
  assert.deepEqual([...PAGE_WRITE_FIELDS].sort(), Object.keys(pageCreateSchema.shape).sort());
  assert.deepEqual(Object.keys(pageUpdateSchema.shape).filter((k) => k !== 'revision').sort(), [...PAGE_WRITE_FIELDS].sort());
});

test('the read schema carries every field of a page', () => {
  const row = {
    id: ID,
    store: ID,
    title: 'About us',
    slug: 'about',
    body: '# About',
    status: 'published',
    showInFooter: true,
    sortOrder: 0,
    revision: 2,
    template: 'about',
    publishedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  assert.equal(storePageSchema.safeParse(row).success, true);
  assert.equal(storePageSchema.safeParse({ ...row, status: 'archived' }).success, false);
  assert.equal(storePageSchema.safeParse({ ...row, revision: -1 }).success, false);
});
