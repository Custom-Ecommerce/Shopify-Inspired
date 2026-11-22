import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/can';

// Sprint 7 (S7-B1): the media policy row. A seller reads, uploads (alt), renames (name) and deletes their own store's files.

test('media: a seller may update the name and nothing else', () => {
  assert.equal(can('seller', 'update', 'media', ['name']), true);
  for (const field of ['alt', 'url', 'store', 'cloudinaryPublicId', 'cloudinaryResourceType', 'filesize', 'width', 'mimeType', '_id']) {
    assert.equal(can('seller', 'update', 'media', ['name', field]), false, field);
    assert.equal(can('seller', 'update', 'media', [field]), false, field);
  }
  // No field list at all is denied (fail closed).
  assert.equal(can('seller', 'update', 'media'), false);
});

test('media: the system may update any field; the admin and the public may not update at all', () => {
  assert.equal(can('system', 'update', 'media', ['name', 'url']), true);
  assert.equal(can('admin', 'update', 'media', ['name']), false);
  assert.equal(can('public', 'update', 'media', ['name']), false);
});

test('media: the earlier rows are unchanged (seller reads, creates with alt only, deletes)', () => {
  assert.equal(can('seller', 'read', 'media'), true);
  assert.equal(can('seller', 'create', 'media', ['alt']), true);
  assert.equal(can('seller', 'create', 'media', ['alt', 'name']), false);
  assert.equal(can('seller', 'delete', 'media'), true);
  assert.equal(can('admin', 'delete', 'media'), true);
  assert.equal(can('public', 'delete', 'media'), false);
  assert.equal(can('public', 'read', 'media'), false);
});
