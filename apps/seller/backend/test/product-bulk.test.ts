import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { PRODUCT_CSV_COLUMNS, productCreateRequestSchema, productUpdateRequestSchema } from '@/lib/contracts';
import { neutraliseCell, parseCsv, restoreCell, serializeCsv } from '@/lib/product-csv';
import { copyTitle } from '@/lib/product-duplicate';
import { Category, Media, Product, Review, ArchivedReview, Store, signSession } from '@/lib/services';

const AUTH_SECRET = 'x'.repeat(40);
const SELLER = '65a000000000000000000001';
const ADMIN = '65a000000000000000000003';
const STORE = '65a000000000000000000011';
const OTHER = '65a000000000000000000012';
const CAT = '65a0000000000000000000c1';
const OTHER_CAT = '65a0000000000000000000c2';
const IMAGE = '65a0000000000000000000e1';
const VIDEO = '65a0000000000000000000e2';
const OTHER_IMAGE = '65a0000000000000000000e3';
const SOURCE = '65a0000000000000000000b1';
const TRASHED = '65a0000000000000000000b2';
const DEMO = '65a0000000000000000000b3';
const TAKEN = '65a0000000000000000000b4';
const FOREIGN = '65a0000000000000000000b5';
const V1 = '65a0000000000000000000d1';
const V2 = '65a0000000000000000000d2';

type Doc = Record<string, unknown>;

interface VariantDoc extends Doc {
  _id: unknown;
  sku: string | null;
  price: number;
  stockQuantity: number;
  trackQuantity: boolean;
  optionValues: string[];
  imageId: unknown;
  position: number;
}

interface Row extends Doc {
  _id: string;
  store: string;
  title: string;
  slug: string;
  isPublished: boolean;
  isDemo: boolean;
  deletedAt: Date | null;
  moderation: { reason: string } | null;
  categories: string[];
  media: string[];
  videos: string[];
  options: Array<{ name: string; values: string[] }>;
  variants: VariantDoc[];
}

interface Chain {
  select: () => Chain;
  sort: () => Chain;
  skip: () => Chain;
  limit: () => Chain;
  populate: () => Chain;
  lean: () => Promise<unknown>;
}

const stubs = {
  mongoose: mongoose as unknown as { connect: () => Promise<unknown> },
  product: Product as unknown as {
    find: (filter: Doc) => Chain;
    findOne: (filter: Doc) => Chain;
    findOneAndUpdate: (filter: Doc, update: unknown) => Chain;
    create: (doc: Doc) => Promise<{ _id: string }>;
    deleteOne: (filter: Doc) => Promise<{ deletedCount: number }>;
  },
  category: Category as unknown as { find: (filter: Doc) => Chain; countDocuments: (filter: Doc) => Promise<number> },
  media: Media as unknown as {
    find: (filter: Doc) => Chain;
    countDocuments: (filter: Doc) => Promise<number>;
    create: (doc: Doc) => Promise<unknown>;
  },
  store: Store as unknown as { exists: (filter: Doc) => Promise<{ _id: string } | null>; findById: (id: string) => Chain },
  review: Review as unknown as { find: () => Chain; deleteMany: () => Promise<unknown> },
  archive: ArchivedReview as unknown as { bulkWrite: () => Promise<unknown> },
};

function matches(row: Row, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === 'variants.sku') return row.variants.some((variant) => (value as { $in: string[] }).$in.includes(variant.sku ?? ''));
    if (key === 'variants._id') return (value as { $all: unknown[] }).$all.every((id) => row.variants.some((variant) => String(variant._id) === String(id)));
    if (value === null) return (row[key] ?? null) === null;
    if (typeof value === 'object' && value !== null) {
      if ('$in' in value) return (value as { $in: string[] }).$in.includes(String(row[key]));
      if ('$ne' in value) return String(row[key] ?? null) !== String((value as { $ne: unknown }).$ne);
    }
    return String(row[key]) === String(value);
  });
}

let categories: Array<{ _id: string; store: string; name: string }>;
let media: Array<{ _id: string; store: string; url: string; resourceType: string }>;
let products: Row[];
let writes: number;
let mediaCreated: number;

function view(row: Row, populated: boolean): Doc {
  if (!populated) return row;
  return {
    ...row,
    categories: row.categories.map((id) => categories.find((category) => category._id === String(id)) ?? null),
    media: row.media.map((id) => media.find((item) => item._id === String(id)) ?? null),
    videos: row.videos.map((id) => media.find((item) => item._id === String(id)) ?? null),
  };
}

function chain(result: () => unknown, map: (value: unknown, populated: boolean) => unknown = (value) => value): Chain {
  let populated = false;
  const q: Chain = {
    select: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    populate: () => {
      populated = true;
      return q;
    },
    lean: async () => map(result(), populated),
  };
  return q;
}

function applyPipeline(row: Row, set: Doc): void {
  for (const [key, value] of Object.entries(set)) {
    if (key === 'variants') {
      row.variants = (value as Doc[]).map((entry) => {
        if ('$literal' in entry) return entry.$literal as VariantDoc;
        const merged = (entry.$mergeObjects as [{ $literal: VariantDoc }])[0].$literal;
        const stored = row.variants.find((variant) => String(variant._id) === String(merged._id));
        assert.ok(stored);
        return { ...merged, stockQuantity: stored.stockQuantity };
      });
    } else {
      row[key] = (value as { $literal: unknown }).$literal;
    }
  }
}

const variant = (id: string, sku: string | null, optionValues: string[], stockQuantity = 7): VariantDoc => ({
  _id: id,
  title: optionValues.join(' / ') || 'Default',
  sku,
  barcode: null,
  price: 1000,
  compareAtPrice: 1500,
  trackQuantity: true,
  stockQuantity,
  lowStockThreshold: null,
  optionValues,
  imageId: optionValues.length > 0 ? IMAGE : null,
  position: 0,
});

function product(id: string, slug: string, overrides: Partial<Row> = {}): Row {
  return {
    _id: id,
    store: STORE,
    title: slug,
    slug,
    minPrice: 1000,
    isPublished: false,
    isDemo: false,
    deletedAt: null,
    deletedBy: null,
    moderation: null,
    categories: [CAT],
    media: [IMAGE],
    videos: [VIDEO],
    tags: [],
    highlights: [],
    options: [],
    variants: [variant(id.slice(0, -2) + 'f1', null, [])],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

let importPOST: (request: NextRequest) => Promise<Response>;
let exportGET: (request: NextRequest) => Promise<Response>;
let duplicatePOST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let itemPATCH: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let itemDELETE: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let mediaRoute: Doc;
let token: string;
let adminToken: string;
let restore: () => void;

before(async () => {
  process.env.SELLER_AUTH_SECRET = AUTH_SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: SELLER, role: 'seller' }, AUTH_SECRET, SELLER_AUDIENCE);
  adminToken = await signSession({ sub: ADMIN, role: 'admin' }, AUTH_SECRET, SELLER_AUDIENCE);
  importPOST = (await import('../src/app/api/products/import/route')).POST;
  exportGET = (await import('../src/app/api/products/export/route')).GET;
  duplicatePOST = (await import('../src/app/api/products/[id]/duplicate/route')).POST;
  const item = await import('../src/app/api/products/[id]/route');
  itemPATCH = item.PATCH;
  itemDELETE = item.DELETE;
  mediaRoute = (await import('../src/app/api/media/route')) as unknown as Doc;
});

beforeEach(() => {
  categories = [
    { _id: CAT, store: STORE, name: 'Lawn' },
    { _id: OTHER_CAT, store: OTHER, name: 'Shoes' },
  ];
  media = [
    { _id: IMAGE, store: STORE, url: 'https://cdn.test/a.jpg', resourceType: 'image' },
    { _id: VIDEO, store: STORE, url: 'https://cdn.test/v.mp4', resourceType: 'video' },
    { _id: OTHER_IMAGE, store: OTHER, url: 'https://cdn.test/other.jpg', resourceType: 'image' },
  ];
  products = [
    product(SOURCE, 'blue-suit', {
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [variant(V1, 'BS-S', ['S']), variant(V2, 'BS-M', ['M'], 3)],
      seoTitle: 'Blue suit',
      avgRating: 4.5,
      reviewCount: 9,
      viewCount: 100,
    }),
    product(TRASHED, 'old-suit', {
      deletedAt: new Date('2026-10-02T00:00:00.000Z'),
      variants: [variant('65a0000000000000000000d3', 'BS-S-COPY', [])],
    }),
    product(DEMO, 'sample', { isDemo: true }),
    product(TAKEN, 'removed', { moderation: { reason: 'Counterfeit' } }),
    product(FOREIGN, 'foreign', { store: OTHER }),
  ];
  writes = 0;
  mediaCreated = 0;

  const saved = {
    connect: stubs.mongoose.connect,
    product: { ...stubs.product },
    category: { ...stubs.category },
    media: { ...stubs.media },
    store: { ...stubs.store },
    review: { ...stubs.review },
    bulk: stubs.archive.bulkWrite,
  };
  let nextId = 0x100;
  const newId = (): string => '65a00000000000000000' + (nextId++).toString(16).padStart(4, '0');

  stubs.mongoose.connect = async () => mongoose;
  stubs.product.find = (filter) => chain(() => products.filter((row) => matches(row, filter)), (rows, populated) => (rows as Row[]).map((row) => view(row, populated)));
  stubs.product.findOne = (filter) => chain(() => products.find((row) => matches(row, filter)) ?? null, (row, populated) => (row ? view(row as Row, populated) : null));
  stubs.product.findOneAndUpdate = (filter, update) => {
    const row = products.find((candidate) => matches(candidate, filter));
    if (row) {
      writes += 1;
      if (Array.isArray(update)) applyPipeline(row, (update[0] as { $set: Doc }).$set);
      else Object.assign(row, (update as { $set: Doc }).$set);
    }
    return chain(() => row ?? null);
  };
  stubs.product.create = async (doc) => {
    writes += 1;
    const created = {
      ...product(newId(), String(doc.slug)),
      videos: [],
      media: [],
      ...doc,
      _id: newId(),
      variants: (doc.variants as VariantDoc[]).map((entry) => ({ ...entry, _id: newId() })),
    } as Row;
    products.push(created);
    return { _id: created._id };
  };
  stubs.product.deleteOne = async (filter) => {
    const before = products.length;
    products = products.filter((row) => !(matches(row, { _id: filter._id, store: filter.store }) && row.deletedAt));
    return { deletedCount: before - products.length };
  };
  stubs.category.find = (filter) => chain(() => categories.filter((row) => row.store === filter.store));
  stubs.category.countDocuments = async (filter) =>
    categories.filter((row) => row.store === filter.store && (filter._id as { $in: string[] }).$in.includes(row._id)).length;
  stubs.media.find = (filter) => chain(() => media.filter((row) => row.store === filter.store && (filter.url as { $in: string[] }).$in.includes(row.url)));
  stubs.media.countDocuments = async (filter) =>
    media.filter((row) => {
      const wanted = filter.resourceType === 'video' ? row.resourceType === 'video' : row.resourceType !== 'video';
      return row.store === filter.store && (filter._id as { $in: string[] }).$in.includes(row._id) && wanted;
    }).length;
  stubs.media.create = async () => {
    mediaCreated += 1;
  };
  stubs.store.exists = async (filter) => (filter._id === STORE ? { _id: STORE } : null);
  stubs.review.find = () => chain(() => []);
  stubs.review.deleteMany = async () => undefined;

  restore = () => {
    stubs.mongoose.connect = saved.connect;
    Object.assign(stubs.product, saved.product);
    Object.assign(stubs.category, saved.category);
    Object.assign(stubs.media, saved.media);
    Object.assign(stubs.store, saved.store);
    Object.assign(stubs.review, saved.review);
    stubs.archive.bulkWrite = saved.bulk;
  };
});

afterEach(() => restore());

type Cells = Partial<Record<(typeof PRODUCT_CSV_COLUMNS)[number], string>>;

const csv = (...rows: Cells[]): string => serializeCsv([[...PRODUCT_CSV_COLUMNS], ...rows.map((row) => PRODUCT_CSV_COLUMNS.map((column) => row[column] ?? ''))]);

const newRow = (overrides: Cells = {}): Cells => ({ Handle: 'new-suit', Title: 'New suit', Category: 'Lawn', 'Variant Price': '2000', 'Variant Inventory Qty': '5', ...overrides });

interface Report {
  dryRun: boolean;
  created: number;
  updated: number;
  failed: number;
  rows: Array<{ row: number; handle: string; status: string; message: string | null; warnings: string[] }>;
  failedCsv: string | null;
}

function upload(text: string | Blob, dryRun = false, sessionToken = token): Promise<Response> {
  const form = new FormData();
  form.append('file', typeof text === 'string' ? new Blob([text], { type: 'text/csv' }) : text, 'products.csv');
  form.append('dryRun', String(dryRun));
  return importPOST(new NextRequest('http://seller.test/api/products/import', { method: 'POST', headers: { authorization: 'Bearer ' + sessionToken, 'x-store-id': STORE }, body: form }));
}

async function run(text: string | Blob, dryRun = false): Promise<Report> {
  const res = await upload(text, dryRun);
  assert.equal(res.status, 200);
  return (await res.json()) as Report;
}

const row = (slug: string): Row => {
  const found = products.find((candidate) => candidate.slug === slug);
  assert.ok(found, slug);
  return found;
};

const errorOf = async (res: Response): Promise<{ code?: string; message: string }> => {
  const body = (await res.json()) as { errors: Array<{ code?: string; message: string }> };
  assert.ok(body.errors[0]);
  return body.errors[0];
};

const authed = (method: string, path: string, body?: unknown, sessionToken = token): NextRequest =>
  new NextRequest('http://seller.test' + path, {
    method,
    headers: { authorization: 'Bearer ' + sessionToken, 'x-store-id': STORE, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const ctx = (id: string): { params: Promise<{ id: string }> } => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown): Promise<Response> => itemPATCH(authed('PATCH', '/api/products/' + id, body), ctx(id));
const duplicate = (id: string, sessionToken = token): Promise<Response> => duplicatePOST(authed('POST', '/api/products/' + id + '/duplicate', undefined, sessionToken), ctx(id));

/* ---------------------------------------------------- SEO ---------------------------------------------------- */

test('seo: limits of 70 and 160 and no HTML, on create and on update', () => {
  const base = { title: 'T', categories: [CAT], price: 100 };
  assert.equal(productCreateRequestSchema.safeParse({ ...base, seoTitle: 'x'.repeat(70), seoDescription: 'y'.repeat(160) }).success, true);
  assert.equal(productCreateRequestSchema.safeParse({ ...base, seoTitle: 'x'.repeat(71) }).success, false);
  assert.equal(productUpdateRequestSchema.safeParse({ seoDescription: 'y'.repeat(161) }).success, false);
  assert.equal(productUpdateRequestSchema.safeParse({ seoTitle: '<b>Sale</b>' }).success, false);
  assert.equal(productUpdateRequestSchema.safeParse({ seoDescription: 'Buy <script>x</script>' }).success, false);
  assert.equal(productUpdateRequestSchema.safeParse({ seoTitle: '3 < 5 stars' }).success, true);
});

test('seo: the image must be an image of this store', async () => {
  assert.equal((await patch(SOURCE, { seoImage: IMAGE })).status, 200);
  for (const id of [VIDEO, OTHER_IMAGE]) {
    const res = await patch(SOURCE, { seoImage: id });
    assert.equal(res.status, 422, id);
    assert.equal((await errorOf(res)).code, 'PRODUCT_MEDIA_INVALID');
  }
});

test('slug: normalised, and a clash says whether the holder is in trash', async () => {
  assert.equal((await patch(SOURCE, { slug: 'New-Slug' })).status, 200);
  assert.equal(products[0]?.slug, 'new-slug');

  const live = await patch(SOURCE, { slug: 'sample' });
  assert.equal(live.status, 409);
  const liveError = await errorOf(live);
  assert.equal(liveError.code, 'PRODUCT_SLUG_TAKEN');
  assert.doesNotMatch(liveError.message, /trash/);

  const trashed = await patch(SOURCE, { slug: 'old-suit' });
  assert.equal(trashed.status, 409);
  assert.match((await errorOf(trashed)).message, /trash/);

  assert.equal((await patch(SOURCE, { slug: 'new-slug' })).status, 200);
  assert.equal((await patch(SOURCE, { slug: 'foreign' })).status, 200);
});

/* ---------------------------------------------------- CSV ---------------------------------------------------- */

test('csv: quoted commas, line breaks and doubled quotes, CRLF, a byte order mark and blank lines', () => {
  const text = '﻿a,b,c\r\n"one, two","line\nbreak","say ""hi"""\r\n\r\nx,,z\n';
  assert.deepEqual(parseCsv(text), [
    ['a', 'b', 'c'],
    ['one, two', 'line\nbreak', 'say "hi"'],
    ['x', '', 'z'],
  ]);
  assert.throws(() => parseCsv('a,"never closed'));
  assert.deepEqual(parseCsv(serializeCsv([['a,b', 'c\nd', 'e"f']])), [['a,b', 'c\nd', 'e"f']]);
});

test('csv: formula cells are neutralised, and only that prefix comes off', () => {
  for (const value of ['=SUM(A1)', '+1', '-1', '@cmd']) {
    assert.equal(neutraliseCell(value), "'" + value);
    assert.equal(restoreCell(neutraliseCell(value)), value);
  }
  assert.equal(neutraliseCell('Plain'), 'Plain');
  assert.equal(restoreCell("'tis the season"), "'tis the season");
});

/* --------------------------------------------------- import --------------------------------------------------- */

test('import: a dry run reports what would happen and writes nothing', async () => {
  const report = await run(csv(newRow()), true);
  assert.equal(report.dryRun, true);
  assert.equal(report.created, 1);
  assert.equal(writes, 0);
  assert.equal(products.some((candidate) => candidate.slug === 'new-suit'), false);
});

test('import: a new product with options; the category is found by name in this store, case and spaces aside', async () => {
  const report = await run(
    csv(newRow({ Category: '  lAWN ', 'Option1 Name': 'Size', 'Option1 Value': 'S', 'Variant SKU': 'NS-S' }), { Handle: 'new-suit', 'Option1 Value': 'M', 'Variant SKU': 'NS-M', 'Variant Price': '2100' }),
  );
  assert.equal(report.created, 1);
  assert.equal(report.failed, 0);
  const created = row('new-suit');
  assert.deepEqual(created.categories.map(String), [CAT]);
  assert.equal(created.variants.length, 2);
  assert.deepEqual(created.options, [{ name: 'Size', values: ['S', 'M'] }]);
  assert.equal(created.isPublished, false);
});

test('import: an unknown category fails the row, and another store\'s name never matches', async () => {
  for (const name of ['Nothing', 'Shoes']) {
    const report = await run(csv(newRow({ Category: name })));
    assert.equal(report.failed, 1, name);
    assert.match(report.rows[0]?.message ?? '', /does not exist in this store/);
  }
  assert.equal(writes, 0);
});

test('import: more than 500 rows is a 422, a file over 2 MB a 413, and nothing is written', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => newRow({ Handle: 'p-' + index }));
  const many = await upload(csv(...rows));
  assert.equal(many.status, 422);
  assert.equal((await errorOf(many)).code, 'IMPORT_TOO_MANY_ROWS');
  assert.equal((await run(csv(...rows.slice(0, 500)), true)).created, 500);

  const big = await upload(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'text/csv' }));
  assert.equal(big.status, 413);
  assert.equal((await errorOf(big)).code, 'IMPORT_FILE_TOO_LARGE');
  assert.equal(writes, 0);
});

test('import: a product is whole or not at all, and one bad product does not stop the next', async () => {
  const report = await run(
    csv(
      newRow({ Handle: 'bad-one', 'Option1 Name': 'Size', 'Option1 Value': 'S' }),
      { Handle: 'bad-one', 'Option1 Value': 'M', 'Variant Price': 'free' },
      newRow({ Handle: 'good-one' }),
    ),
  );
  assert.equal(report.created, 1);
  assert.equal(report.failed, 1);
  assert.equal(products.some((candidate) => candidate.slug === 'bad-one'), false);
  assert.ok(products.some((candidate) => candidate.slug === 'good-one'));
  assert.deepEqual(report.rows.map((entry) => [entry.row, entry.status]), [[2, 'error'], [3, 'error'], [4, 'ok']]);
  assert.match(report.rows[1]?.message ?? '', /Variant Price/);
  assert.match(report.rows[0]?.message ?? '', /row 3/);
  assert.match(report.failedCsv ?? '', /bad-one/);
  assert.doesNotMatch(report.failedCsv ?? '', /good-one/);
});

test('import: an update keeps existing stock, warns, adds a new variant with its own stock, and never removes one', async () => {
  const report = await run(
    csv(
      { Handle: 'blue-suit', 'Option1 Name': 'Size', 'Option1 Value': 'S', 'Variant Price': '1200', 'Variant Inventory Qty': '999' },
      { Handle: 'blue-suit', 'Option1 Value': 'L', 'Variant Price': '1300', 'Variant Inventory Qty': '4' },
    ),
  );
  assert.equal(report.updated, 1);
  assert.match(report.rows[0]?.warnings[0] ?? '', /Inventory/);
  const updated = row('blue-suit');
  const [small, medium, large] = updated.variants;
  assert.equal(String(small?._id), V1);
  assert.equal(small?.stockQuantity, 7);
  assert.equal(small?.price, 1200);
  assert.equal(String(medium?._id), V2);
  assert.equal(medium?.stockQuantity, 3);
  assert.equal(large?.stockQuantity, 4);
  assert.deepEqual(updated.options[0]?.values, ['S', 'M', 'L']);
});

test('import: an empty cell leaves a field alone, and a dry-run update writes nothing', async () => {
  await run(csv({ Handle: 'blue-suit', Title: 'Renamed' }), true);
  assert.equal(writes, 0);
  assert.equal(row('blue-suit').title, 'blue-suit');
  await run(csv({ Handle: 'blue-suit', Title: 'Renamed' }));
  assert.equal(row('blue-suit').title, 'Renamed');
  assert.deepEqual(row('blue-suit').media, [IMAGE]);
  assert.equal(row('blue-suit').seoTitle, 'Blue suit');
});

test('import: never publishes a taken-down product and never clears the takedown', async () => {
  const report = await run(csv({ Handle: 'removed', Title: 'Changed', Published: 'TRUE' }));
  assert.equal(report.updated, 1);
  assert.match(report.rows[0]?.warnings[0] ?? '', /admin removed/i);
  const taken = row('removed');
  assert.equal(taken.isPublished, false);
  assert.deepEqual(taken.moderation, { reason: 'Counterfeit' });
});

test('import: a Handle held in trash is a row error and the product is untouched', async () => {
  const report = await run(csv(newRow({ Handle: 'old-suit', Title: 'Back' })));
  assert.equal(report.failed, 1);
  assert.match(report.rows[0]?.message ?? '', /trash/);
  assert.equal(row('old-suit').title, 'old-suit');
});

test('import: Published=TRUE publishes a new product that passes, and leaves one with no price above 0 a draft with a warning', async () => {
  const report = await run(csv(newRow({ Handle: 'priced', Published: 'TRUE' }), newRow({ Handle: 'free-one', Published: 'TRUE', 'Variant Price': '0' })));
  assert.equal(report.created, 2);
  assert.equal(row('priced').isPublished, true);
  assert.equal(row('free-one').isPublished, false);
  assert.match(report.rows[1]?.warnings[0] ?? '', /draft/i);
});

test('import: the sample product is refused whole, so an import can never make it publishable (D-037)', async () => {
  const report = await run(csv({ Handle: 'sample', Title: 'Edited', Published: 'TRUE' }));
  assert.equal(report.failed, 1);
  assert.match(report.rows[0]?.message ?? '', /sample product/);
  assert.equal(row('sample').isPublished, false);
  assert.equal(row('sample').isDemo, true);
  assert.equal(row('sample').title, 'sample');
  assert.equal(writes, 0);
});

test('import: media must already be in this store, the right kind, and is never fetched', async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response('{}');
  }) as typeof fetch;
  try {
    assert.match((await run(csv(newRow({ 'Image URLs': 'https://cdn.test/other.jpg' })))).rows[0]?.message ?? '', /not in this store/);
    assert.match((await run(csv(newRow({ 'Image URLs': 'https://evil.test/x.jpg' })))).rows[0]?.message ?? '', /not in this store/);
    assert.match((await run(csv(newRow({ 'Video URLs': 'https://cdn.test/a.jpg' })))).rows[0]?.message ?? '', /not a video/);
    assert.match((await run(csv(newRow({ 'Image URLs': 'https://cdn.test/v.mp4' })))).rows[0]?.message ?? '', /not an image/);
    assert.equal(fetched, 0);
    const good = await run(csv(newRow({ 'Image URLs': 'https://cdn.test/a.jpg', 'Video URLs': 'https://cdn.test/v.mp4' })));
    assert.equal(good.created, 1);
    assert.deepEqual(row('new-suit').media.map(String), [IMAGE]);
    assert.deepEqual(row('new-suit').videos.map(String), [VIDEO]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('import: one SKU on two new products fails the second, in a dry run too', async () => {
  const text = csv(newRow({ Handle: 'a-one', 'Variant SKU': 'SAME' }), newRow({ Handle: 'b-two', 'Variant SKU': 'SAME' }));
  const report = await run(text, true);
  assert.equal(report.created, 1);
  assert.equal(report.failed, 1);
});

test('import: a bad header is refused, and an admin may not import', async () => {
  assert.equal((await upload('Title,Price\nA,1\n')).status, 422);
  assert.equal((await upload(csv(newRow()), false, adminToken)).status, 403);
});

test('import: what the export wrote imports again with no change to stock', async () => {
  const exported = await (await exportGET(authed('GET', '/api/products/export'))).text();
  const report = await run(exported);
  assert.equal(report.failed, 1, JSON.stringify(report.rows.filter((entry) => entry.status === 'error')));
  assert.equal(report.rows.find((entry) => entry.status === 'error')?.handle, 'sample');
  assert.equal(report.updated, 2);
  assert.equal(report.rows.flatMap((entry) => entry.warnings).length, 0);
  assert.deepEqual(row('blue-suit').variants.map((entry) => [String(entry._id), entry.stockQuantity]), [[V1, 7], [V2, 3]]);
  assert.deepEqual(row('removed').moderation, { reason: 'Counterfeit' });
});

/* --------------------------------------------------- export --------------------------------------------------- */

test('export: this store only, not trash, one row per variant, and nothing about moderation', async () => {
  const res = await exportGET(authed('GET', '/api/products/export'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  const text = await res.text();
  const records = parseCsv(text);
  assert.deepEqual(records[0], [...PRODUCT_CSV_COLUMNS]);
  const handles = records.slice(1).map((record) => record[0]);
  assert.deepEqual(handles, ['blue-suit', 'blue-suit', 'sample', 'removed']);
  assert.doesNotMatch(text, /foreign|old-suit|Counterfeit/);
  assert.equal(records[1]?.[PRODUCT_CSV_COLUMNS.indexOf('Image URLs')], 'https://cdn.test/a.jpg');
  assert.equal(records[1]?.[PRODUCT_CSV_COLUMNS.indexOf('Video URLs')], 'https://cdn.test/v.mp4');
  assert.equal(records[2]?.[PRODUCT_CSV_COLUMNS.indexOf('Title')], '');
});

test('export: a cell starting = + - @ is neutralised', async () => {
  for (const title of ['=HYPERLINK("http://evil.test")', '+1', '-1', '@cmd']) {
    row('blue-suit').title = title;
    const records = parseCsv(await (await exportGET(authed('GET', '/api/products/export'))).text());
    assert.equal(records[1]?.[PRODUCT_CSV_COLUMNS.indexOf('Title')], "'" + title);
  }
});

test('export: an admin may not export, and the template is the columns with an example', async () => {
  assert.equal((await exportGET(authed('GET', '/api/products/export', undefined, adminToken))).status, 403);
  const records = parseCsv(await (await exportGET(authed('GET', '/api/products/export?template=1'))).text());
  assert.deepEqual(records[0], [...PRODUCT_CSV_COLUMNS]);
  assert.equal(records.length, 3);
});

/* ------------------------------------------- encoding and apostrophes ------------------------------------------- */

const URDU_TITLE = 'اردو عنوان';
const URDU_TEXT = 'یہ ایک خوبصورت سوٹ ہے۔ کیا آپ کو پسند آیا؟';
const startsWithBom = (bytes: ArrayBuffer): boolean => {
  const view = new Uint8Array(bytes);
  return view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf;
};

test('csv: a seller\'s own leading apostrophe survives the round trip exactly (GAP 9)', () => {
  const cases: Array<[string, string]> = [
    ["'=x", "''=x"],
    ['=x', "'=x"],
    ["'x", "'x"],
    ["''=x", "'''=x"],
    ['x', 'x'],
  ];
  for (const [value, written] of cases) {
    assert.equal(neutraliseCell(value), written, value);
    assert.equal(restoreCell(neutraliseCell(value)), value, value);
    assert.deepEqual(parseCsv(serializeCsv([[value]])).map((record) => record.map(restoreCell)), [[value]], value);
  }
});

test('export: the file, the template and the failed rows start with a UTF-8 byte order mark, EF BB BF (GAP 4)', async () => {
  // Response.text() would drop the mark, so the bytes are read.
  assert.ok(startsWithBom(await (await exportGET(authed('GET', '/api/products/export'))).arrayBuffer()), 'export');
  assert.ok(startsWithBom(await (await exportGET(authed('GET', '/api/products/export?template=1'))).arrayBuffer()), 'template');
  const report = await run(csv(newRow({ Category: 'Nothing' })));
  assert.ok(report.failedCsv?.startsWith('﻿'), 'failed rows');
  assert.ok(startsWithBom(await new Blob([report.failedCsv ?? '']).arrayBuffer()), 'failed rows, as the browser saves them');
});

test('import: Urdu survives export and re-import unchanged, byte order mark and all (GAP 4)', async () => {
  row('blue-suit').title = URDU_TITLE;
  row('blue-suit').description = URDU_TEXT;
  const bytes = await (await exportGET(authed('GET', '/api/products/export'))).arrayBuffer();
  assert.ok(startsWithBom(bytes));
  const records = parseCsv(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes));
  assert.equal(records[0]?.[0], 'Handle', 'the mark never leaks into the first column name');
  assert.equal(records[1]?.[PRODUCT_CSV_COLUMNS.indexOf('Title')], URDU_TITLE);

  const report = await run(new Blob([bytes], { type: 'text/csv' }));
  const blue = report.rows.filter((entry) => entry.handle === 'blue-suit');
  assert.ok(blue.length > 0 && blue.every((entry) => entry.status === 'ok' && entry.warnings.length === 0), JSON.stringify(blue));
  assert.equal(row('blue-suit').title, URDU_TITLE);
  assert.equal(row('blue-suit').description, URDU_TEXT);
});

test('import: text a wrong encoding already damaged is refused, never stored (GAP 4)', async () => {
  const damaged: Cells[] = [
    { Title: 'Ø§Ø±Ø¯Ùˆ Ø¹Ù†ÙˆØ§Ù†' },
    { Title: 'Lawn suit', Description: 'ÛŒÛ Ø§ÛŒÚ© Ø³ÙˆÙ¹ ÛÛ’' },
    { Title: '???? ?????' },
    { Title: 'Lawn suit', Description: '?? ??? ???? ?? ????' },
    { Title: 'Lawn suit', 'Option1 Name': 'Size', 'Option1 Value': 'S�' },
    { Title: 'Suit ��' },
  ];
  for (const cells of damaged) {
    const report = await run(csv(newRow(cells)));
    assert.equal(report.failed, 1, JSON.stringify(cells));
    assert.equal(report.rows[0]?.message, 'This text looks damaged by the wrong file encoding. Save the file as CSV UTF-8 and import again.');
  }
  assert.equal(writes, 0);
  assert.equal(products.some((candidate) => candidate.slug === 'new-suit'), false);
});

test('import: real Urdu, accented Latin and an honest question mark are not mistaken for damage', async () => {
  const fine: Cells[] = [
    { Handle: 'cafe', Title: 'Café', Description: 'Crème brûlée, Größe M, São Paulo, Øl' },
    { Handle: 'what', Title: 'What?', Description: 'Really??? Yes.' },
    { Handle: 'urdu', Title: URDU_TITLE, Description: URDU_TEXT },
  ];
  const report = await run(csv(...fine.map((cells) => newRow(cells))));
  assert.equal(report.failed, 0, JSON.stringify(report.rows));
  assert.equal(report.created, 3);
  assert.equal(row('urdu').title, URDU_TITLE);
  assert.equal(row('cafe').title, 'Café');
  assert.equal(row('what').title, 'What?');
});

/* -------------------------------------------------- duplicate -------------------------------------------------- */

test('duplicate: a draft with new variant ids, unique SKUs, the same Media rows, and no new Media row', async () => {
  const res = await duplicate(SOURCE);
  assert.equal(res.status, 201);
  const body = (await res.json()) as { id: string; slug: string; title: string; status: string };
  assert.equal(body.title, 'blue-suit (Copy)');
  assert.equal(body.slug, 'blue-suit-copy');
  assert.equal(body.status, 'draft');

  const copy = row('blue-suit-copy');
  assert.equal(copy.isPublished, false);
  assert.equal(copy.isDemo, false);
  assert.equal(copy.moderation, null);
  assert.equal(copy.deletedAt, null);
  assert.equal(copy.viewCount, 0);
  assert.equal(copy.avgRating, 0);
  assert.equal(copy.reviewCount, 0);
  assert.equal(copy.seoTitle, 'Blue suit');
  assert.deepEqual(copy.options, [{ name: 'Size', values: ['S', 'M'] }]);

  const ids = copy.variants.map((entry) => String(entry._id));
  assert.equal(ids.includes(V1) || ids.includes(V2), false);
  assert.equal(new Set(ids).size, 2);
  // BS-S-COPY is held by a product in trash, so the next one is taken (D-041).
  assert.deepEqual(copy.variants.map((entry) => entry.sku), ['BS-S-COPY-2', 'BS-M-COPY']);
  assert.deepEqual(copy.variants.map((entry) => entry.stockQuantity), [7, 3]);
  assert.deepEqual(copy.variants.map((entry) => entry.compareAtPrice), [1500, 1500]);
  assert.deepEqual(copy.variants.map((entry) => String(entry.imageId)), [IMAGE, IMAGE]);

  assert.deepEqual(copy.media.map(String), [IMAGE]);
  assert.deepEqual(copy.videos.map(String), [VIDEO]);
  assert.equal(mediaCreated, 0);
  assert.equal(media.length, 3);
});

test('duplicate: a slug held by a product in trash is skipped, and the source is untouched', async () => {
  products.push(product('65a0000000000000000000b6', 'blue-suit-copy', { deletedAt: new Date() }));
  const res = await duplicate(SOURCE);
  assert.equal(((await res.json()) as { slug: string }).slug, 'blue-suit-copy-2');
  assert.equal(row('blue-suit').variants[0]?.sku, 'BS-S');
  assert.equal(row('blue-suit').avgRating, 4.5);
});

test('duplicate: a long title and slug still fit', async () => {
  assert.equal(copyTitle('x'.repeat(200)).length, 200);
  assert.ok(copyTitle('x'.repeat(200)).endsWith(' (Copy)'));
  row('blue-suit').slug = 'a'.repeat(200);
  const res = await duplicate(SOURCE);
  assert.equal(res.status, 201);
  assert.equal(((await res.json()) as { slug: string }).slug.length, 200);
});

test('duplicate: refused for the sample, a taken-down, a trashed, another store\'s, and for an admin', async () => {
  const demo = await duplicate(DEMO);
  assert.equal(demo.status, 422);
  assert.equal((await errorOf(demo)).code, 'PRODUCT_DEMO_NOT_DUPLICABLE');

  const taken = await duplicate(TAKEN);
  assert.equal(taken.status, 403);
  assert.equal((await errorOf(taken)).code, 'PRODUCT_TAKEN_DOWN');

  assert.equal((await duplicate(TRASHED)).status, 404);
  assert.equal((await duplicate(FOREIGN)).status, 404);
  assert.equal((await duplicate(SOURCE, adminToken)).status, 403);
  assert.equal(products.length, 5);
});

/* ------------------------------------------------- media safety ------------------------------------------------- */

test('media: no route can delete a Media row, and purging one product leaves the row its copy shares', async () => {
  assert.equal('DELETE' in mediaRoute, false);

  const copy = (await (await duplicate(SOURCE)).json()) as { id: string };
  row('blue-suit').deletedAt = new Date();
  const purge = new NextRequest('http://seller.test/api/products/' + SOURCE + '?permanent=true', { method: 'DELETE', headers: { authorization: 'Bearer ' + token, 'x-store-id': STORE } });
  assert.equal((await itemDELETE(purge, ctx(SOURCE))).status, 200);

  assert.equal(products.some((candidate) => candidate._id === SOURCE), false);
  assert.equal(media.length, 3);
  const survivor = products.find((candidate) => candidate._id === copy.id);
  assert.deepEqual(survivor?.media.map(String), [IMAGE]);
});
