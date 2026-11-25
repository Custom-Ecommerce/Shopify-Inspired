import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_NAME_MAX, mediaRenameRequestSchema, mediaSchema, mediaUsageResponseSchema } from '../src/media';

// Sprint 7 (S7-B1): the rename body, the usage answer, and the library name on the record.

const ID = '65a000000000000000000001';

test('a rename body is a name and nothing else', () => {
  assert.deepEqual(mediaRenameRequestSchema.parse({ name: '  Summer lookbook  ' }), { name: 'Summer lookbook' });
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(MEDIA_NAME_MAX + 1) }, { name: 5 }, { name: null }]) {
    assert.equal(mediaRenameRequestSchema.safeParse(body).success, false, JSON.stringify(body));
  }
  assert.equal(mediaRenameRequestSchema.safeParse({ name: 'x'.repeat(MEDIA_NAME_MAX) }).success, true);
});

test('a rename body refuses every other key: the url, the alt text, the store, the file id', () => {
  for (const key of ['url', 'alt', 'store', 'cloudinaryPublicId', 'id', '_id']) {
    const parsed = mediaRenameRequestSchema.safeParse({ name: 'Fine', [key]: 'x' });
    assert.equal(parsed.success, false, key);
    if (!parsed.success) assert.equal(parsed.error.issues[0]?.code, 'unrecognized_keys', key);
  }
});

test('a media record may carry a name, or none', () => {
  const base = {
    id: ID,
    store: ID,
    alt: 'Shirt',
    url: 'https://res.cloudinary.com/demo/image/upload/v1/markaz/a.jpg',
    cloudinaryPublicId: 'markaz/a',
    cloudinaryResourceType: 'image',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  assert.equal(mediaSchema.safeParse(base).success, true);
  assert.equal(mediaSchema.safeParse({ ...base, name: 'Shirt front' }).success, true);
  assert.equal(mediaSchema.safeParse({ ...base, name: null }).success, true);
});

test('the usage answer lists the features that use the file, with a count and the first items', () => {
  const ok = mediaUsageResponseSchema.safeParse({
    mediaId: ID,
    inUse: true,
    total: 3,
    features: [
      { key: 'products', label: 'Products', count: 2, items: [{ id: ID, title: 'Lawn suit' }] },
      { key: 'branding', label: 'Store settings', count: 1, items: [{ id: 'logo', title: 'Store logo' }] },
    ],
  });
  assert.equal(ok.success, true);
  assert.equal(mediaUsageResponseSchema.safeParse({ mediaId: ID, inUse: false, total: 0, features: [] }).success, true);
  assert.equal(mediaUsageResponseSchema.safeParse({ mediaId: 'nope', inUse: false, total: 0, features: [] }).success, false);
  assert.equal(mediaUsageResponseSchema.safeParse({ mediaId: ID, inUse: false, total: -1, features: [] }).success, false);
});
