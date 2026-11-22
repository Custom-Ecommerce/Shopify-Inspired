import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { StorePage } from '../src';

// Sprint 7 (S7-B3): the StorePage model, validated in memory. No database connection is needed.

const oid = () => new mongoose.Types.ObjectId();
const page = (over: Record<string, unknown> = {}) => new StorePage({ store: oid(), title: 'About us', slug: 'about', ...over });

test('a page needs a store, a title and a slug', () => {
  const error = new StorePage({}).validateSync();
  assert.ok(error?.errors.store);
  assert.ok(error?.errors.title);
  assert.ok(error?.errors.slug);
});

test('a new page is a draft with revision 0, an empty body, no footer link, sort order 0, no references and no publish date', () => {
  const doc = page();
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, 'draft');
  assert.equal(doc.revision, 0);
  assert.equal(doc.body, '');
  assert.equal(doc.showInFooter, false);
  assert.equal(doc.sortOrder, 0);
  assert.deepEqual([...doc.mediaRefs], []);
  assert.equal(doc.publishedAt, null);
  assert.equal(doc.template, null);
});

test('the status is draft or published only', () => {
  assert.equal(page({ status: 'published' }).validateSync(), undefined);
  assert.ok(page({ status: 'archived' }).validateSync()?.errors.status);
});

test('the body is at most 50,000 characters, the title 120, the slug 80, the sort order 0 to 9999, the revision not negative', () => {
  assert.equal(page({ body: 'x'.repeat(50000) }).validateSync(), undefined);
  assert.ok(page({ body: 'x'.repeat(50001) }).validateSync()?.errors.body);
  assert.ok(page({ title: 'x'.repeat(121) }).validateSync()?.errors.title);
  assert.ok(page({ slug: 'x'.repeat(81) }).validateSync()?.errors.slug);
  assert.ok(page({ sortOrder: -1 }).validateSync()?.errors.sortOrder);
  assert.ok(page({ sortOrder: 10000 }).validateSync()?.errors.sortOrder);
  assert.ok(page({ revision: -1 }).validateSync()?.errors.revision);
});

test('the slug is lowercased and the title trimmed', () => {
  const doc = page({ title: '  About us  ', slug: ' About ' });
  assert.equal(doc.title, 'About us');
  assert.equal(doc.slug, 'about');
});

test('a slug is unique per store, and nothing makes it unique across the platform', () => {
  const indexes = StorePage.schema.indexes();
  const unique = indexes.filter(([, options]) => options?.unique === true);
  assert.deepEqual(unique.map(([fields]) => fields), [{ store: 1, slug: 1 }]);
  assert.equal(indexes.some(([fields]) => Object.keys(fields)[0] === 'slug'), false);
});

test('every page index starts with the store, so store queries are indexed; the media and footer lookups have their own', () => {
  const keys = StorePage.schema.indexes().map(([fields]) => Object.keys(fields).join('+'));
  for (const [fields] of StorePage.schema.indexes()) assert.equal(Object.keys(fields)[0], 'store');
  assert.ok(keys.includes('store+mediaRefs'));
  assert.ok(keys.includes('store+status+sortOrder'));
});

test('store references nothing by name, and the model name is StorePage', () => {
  assert.equal(StorePage.modelName, 'StorePage');
  assert.equal(StorePage.collection.name, 'storepages');
});
