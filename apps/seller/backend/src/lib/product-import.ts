import type { ProductCreateRequest, ProductCsvColumn, ProductImportReport, ProductImportRow, ProductUpdateRequest, ProductVariantPatch } from '@markaz/contracts';
import { PRODUCT_CSV_COLUMNS, PRODUCT_IMPORT_MAX_ROWS, productCreateRequestSchema, productUpdateRequestSchema } from '@/lib/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { CsvFormatError, DAMAGED_TEXT_MESSAGE, looksDamaged, parseCsv, restoreCell, serializeCsv } from '@/lib/product-csv';
import { publishProblem } from '@/lib/product-lifecycle';
import { ProductVariantError, withSkuGuard } from '@/lib/product-variants';
import {
  ProductRequestError,
  applyProductUpdate,
  prepareProductCreate,
  prepareProductUpdate,
  type VariantRow,
} from '@/lib/products';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { Category, Media, Product } from '@/lib/services';

interface CsvRow {
  /** The row in the file. The header is row 1. */
  row: number;
  raw: string[];
  get: (column: ProductCsvColumn) => string;
}

interface ExistingProduct {
  _id: unknown;
  slug: string;
  title: string;
  options?: Array<{ name: string; values: string[] }> | null;
  variants: VariantRow[];
  media?: unknown[] | null;
  categories?: unknown[] | null;
  isPublished?: boolean | null;
  isDemo?: boolean | null;
  moderation?: { reason: string } | null;
  deletedAt?: unknown;
}

/** A refusal that belongs to one row of a product. The whole product still fails with it. */
class RowProblem extends Error {
  readonly row: number;

  constructor(row: number, message: string) {
    super(message);
    this.row = row;
  }
}

interface ImportContext {
  storeId: string;
  dryRun: boolean;
  categories: Map<string, string[]>;
  media: Map<string, { id: string; isVideo: boolean }>;
  existing: Map<string, ExistingProduct>;
  /** SKUs of products already accepted in this file: the store's own check cannot see them during a dry run. */
  fileSkus: Map<string, string>;
}

const list = (cell: string): string[] =>
  cell
    .split('|')
    .map((value) => value.trim())
    .filter((value) => value !== '');

function bool(row: CsvRow, column: ProductCsvColumn): boolean | undefined {
  const value = row.get(column).toUpperCase();
  if (value === '') return undefined;
  if (value === 'TRUE') return true;
  if (value === 'FALSE') return false;
  throw new RowProblem(row.row, column + ' must be TRUE or FALSE.');
}

function amount(row: CsvRow, column: ProductCsvColumn): number | undefined {
  const value = row.get(column);
  if (value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new RowProblem(row.row, column + ' must be a number, 0 or more.');
  return parsed;
}

function wholeNumber(row: CsvRow, column: ProductCsvColumn): number | undefined {
  const value = amount(row, column);
  if (value !== undefined && !Number.isInteger(value)) throw new RowProblem(row.row, column + ' must be a whole number.');
  return value;
}

function optionNames(first: CsvRow): string[] {
  const names = [first.get('Option1 Name'), first.get('Option2 Name'), first.get('Option3 Name')];
  let used = names.length;
  while (used > 0 && names[used - 1] === '') used -= 1;
  if (names.slice(0, used).some((name) => name === '')) throw new RowProblem(first.row, 'Fill Option1 Name first, then Option2 Name, then Option3 Name.');
  return names.slice(0, used);
}

function optionValues(row: CsvRow, count: number): string[] {
  const values = [row.get('Option1 Value'), row.get('Option2 Value'), row.get('Option3 Value')];
  if (values.slice(count).some((value) => value !== '')) throw new RowProblem(row.row, 'This row has an option value with no option name.');
  return values.slice(0, count);
}

const VARIANT_COLUMNS = [
  'Option1 Value',
  'Option2 Value',
  'Option3 Value',
  'Variant SKU',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Inventory Qty',
  'Track Quantity',
] as const;

const hasVariantCells = (row: CsvRow): boolean => VARIANT_COLUMNS.some((column) => row.get(column) !== '');

/** Names to ids, inside this store only. A name that is unknown or held twice fails the row: nothing is guessed. */
function categoryIds(first: CsvRow, context: ImportContext): string[] {
  return list(first.get('Category')).map((name) => {
    const ids = context.categories.get(name.toLowerCase()) ?? [];
    if (ids.length === 0) throw new RowProblem(first.row, 'Category "' + name + '" does not exist in this store.');
    if (ids.length > 1) throw new RowProblem(first.row, 'Two categories in this store are named "' + name + '".');
    return ids[0] as string;
  });
}

/** URLs of this store's own media. Nothing is ever fetched. */
function mediaIds(first: CsvRow, column: 'Image URLs' | 'Video URLs', context: ImportContext): string[] {
  const wantVideo = column === 'Video URLs';
  return list(first.get(column)).map((url) => {
    const found = context.media.get(url);
    if (!found) throw new RowProblem(first.row, 'This media is not in this store: ' + url);
    if (found.isVideo !== wantVideo) throw new RowProblem(first.row, (wantVideo ? 'This is not a video: ' : 'This is not an image: ') + url);
    return found.id;
  });
}

/** The fields of the first row, only where the cell is filled: on an update an empty cell leaves the value alone. */
function contentFields(first: CsvRow, context: ImportContext): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const text = (column: ProductCsvColumn, key: string): void => {
    if (first.get(column) !== '') fields[key] = first.get(column);
  };
  text('Title', 'title');
  text('Description', 'description');
  text('SEO Title', 'seoTitle');
  text('SEO Description', 'seoDescription');
  const hide = bool(first, 'Hide When Out Of Stock');
  if (hide !== undefined) fields.hideWhenOutOfStock = hide;
  if (first.get('Category') !== '') fields.categories = categoryIds(first, context);
  if (first.get('Image URLs') !== '') fields.media = mediaIds(first, 'Image URLs', context);
  if (first.get('Video URLs') !== '') fields.videos = mediaIds(first, 'Video URLs', context);
  return fields;
}

function assertFileSkusFree(rows: readonly CsvRow[], handle: string, context: ImportContext): void {
  for (const row of rows) {
    const sku = row.get('Variant SKU');
    const holder = sku === '' ? undefined : context.fileSkus.get(sku);
    if (holder !== undefined && holder !== handle) throw new RowProblem(row.row, 'SKU ' + sku + ' is already used by ' + holder + ' in this file.');
  }
}

function rememberFileSkus(rows: readonly CsvRow[], handle: string, context: ImportContext): void {
  for (const row of rows) {
    if (row.get('Variant SKU') !== '') context.fileSkus.set(row.get('Variant SKU'), handle);
  }
}

function contractIssue(first: CsvRow, issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): RowProblem {
  const issue = issues[0];
  return new RowProblem(first.row, issue ? (issue.path.length > 0 ? issue.path.map(String).join('.') + ': ' : '') + issue.message : 'This product is not valid.');
}

type Warnings = Map<number, string[]>;

function warn(warnings: Warnings, row: number, message: string): void {
  warnings.set(row, [...(warnings.get(row) ?? []), message]);
}

async function createFromRows(handle: string, rows: readonly CsvRow[], context: ImportContext, warnings: Warnings): Promise<void> {
  const first = rows[0] as CsvRow;
  if (first.get('Title') === '') throw new RowProblem(first.row, 'A new product needs a Title.');
  if (first.get('Category') === '') throw new RowProblem(first.row, 'A new product needs a Category.');

  const names = optionNames(first);
  const options = names.map((name) => ({ name, values: [] as string[] }));
  const variants = rows.map((row) => {
    const values = optionValues(row, names.length);
    if (values.some((value) => value === '')) throw new RowProblem(row.row, 'Give a value for each option.');
    values.forEach((value, index) => {
      const option = options[index];
      if (option && !option.values.includes(value)) option.values.push(value);
    });
    const price = amount(row, 'Variant Price');
    if (price === undefined) throw new RowProblem(row.row, 'A new variant needs a Variant Price.');
    return {
      optionValues: values,
      price,
      compareAtPrice: amount(row, 'Variant Compare At Price') ?? null,
      stockQuantity: wholeNumber(row, 'Variant Inventory Qty') ?? 0,
      trackQuantity: bool(row, 'Track Quantity') ?? true,
      ...(row.get('Variant SKU') !== '' ? { sku: row.get('Variant SKU') } : {}),
    };
  });

  const parsed = productCreateRequestSchema.safeParse({ ...contentFields(first, context), slug: handle, options, variants });
  if (!parsed.success) throw contractIssue(first, parsed.error.issues);
  const data: ProductCreateRequest = parsed.data;
  const document = await prepareProductCreate(context.storeId, data);

  let publish = false;
  if (bool(first, 'Published') === true) {
    const problem = publishProblem({ title: document.title, categories: document.categories, variants: document.variants });
    if (problem) warn(warnings, first.row, 'Created as a draft: ' + problem.message);
    else publish = true;
  }
  if (context.dryRun) return;

  const created = await withSkuGuard(() => Product.create({ ...document, isPublished: publish }));
  await revalidateStoreProduct(context.storeId, String(created._id));
}

/**
 * The variants of an update, as the whole list D-036 asks for. A row matches an existing variant by its option values, then
 * by SKU, and sends no stock (D-034). A variant the file does not mention stays: an import never deletes one.
 */
function patchedVariants(
  rows: readonly CsvRow[],
  current: ExistingProduct,
  warnings: Warnings,
): { options: Array<{ name: string; values: string[] }>; variants: ProductVariantPatch[] } {
  const first = rows[0] as CsvRow;
  const options = (current.options ?? []).map((option) => ({ name: option.name, values: [...option.values] }));
  const names = optionNames(first);
  if (names.length > 0) {
    const same = names.length === options.length && names.every((name, index) => name.toLowerCase() === options[index]?.name.toLowerCase());
    if (!same) throw new RowProblem(first.row, 'These options differ from the product. Change options in the product form.');
  }

  const key = (values: readonly string[]): string => JSON.stringify(values);
  const patches = new Map<string, ProductVariantPatch>();
  const added: ProductVariantPatch[] = [];

  for (const row of rows.filter(hasVariantCells)) {
    const values = optionValues(row, options.length);
    const anyValue = values.some((value) => value !== '');
    if (anyValue && values.some((value) => value === '')) throw new RowProblem(row.row, 'Give a value for each option.');
    const sku = row.get('Variant SKU');
    const match =
      (options.length === 0 ? current.variants[0] : undefined) ??
      (anyValue ? current.variants.find((variant) => key(variant.optionValues ?? []) === key(values)) : undefined) ??
      (sku !== '' ? current.variants.find((variant) => variant.sku === sku) : undefined);

    if (anyValue) {
      values.forEach((value, index) => {
        const option = options[index];
        if (option && !option.values.includes(value)) option.values.push(value);
      });
    }
    const price = amount(row, 'Variant Price');
    const compareAt = amount(row, 'Variant Compare At Price');
    const track = bool(row, 'Track Quantity');
    const stock = wholeNumber(row, 'Variant Inventory Qty');
    const fields: ProductVariantPatch = {
      ...(price !== undefined ? { price } : {}),
      ...(compareAt !== undefined ? { compareAtPrice: compareAt } : {}),
      ...(track !== undefined ? { trackQuantity: track } : {}),
      ...(sku !== '' ? { sku } : {}),
      ...(anyValue ? { optionValues: values } : {}),
    };

    if (match) {
      const id = String(match._id);
      if (patches.has(id)) throw new RowProblem(row.row, 'Two rows name the same variant.');
      patches.set(id, { id, ...fields });
      if (stock !== undefined && stock !== match.stockQuantity) {
        warn(warnings, row.row, 'Variant Inventory Qty was ignored: stock of an existing variant changes in Inventory.');
      }
    } else {
      if (options.length > 0 && !anyValue) throw new RowProblem(row.row, 'This row matches no variant. Give its option values or its SKU.');
      if (price === undefined) throw new RowProblem(row.row, 'A new variant needs a Variant Price.');
      added.push({ ...fields, stockQuantity: stock ?? 0 });
    }
  }

  const kept = current.variants.map((variant) => patches.get(String(variant._id)) ?? { id: String(variant._id) });
  return { options, variants: [...kept, ...added] };
}

async function updateFromRows(handle: string, rows: readonly CsvRow[], current: ExistingProduct, context: ImportContext, warnings: Warnings): Promise<void> {
  const first = rows[0] as CsvRow;
  const id = String(current._id);
  const fields: Record<string, unknown> = { ...contentFields(first, context), slug: handle };
  if (rows.some(hasVariantCells)) Object.assign(fields, patchedVariants(rows, current, warnings));

  const parsed = productUpdateRequestSchema.safeParse(fields);
  if (!parsed.success) throw contractIssue(first, parsed.error.issues);
  const data: ProductUpdateRequest = parsed.data;
  const prepared = await prepareProductUpdate(context.storeId, id, data, current);

  const published = bool(first, 'Published');
  let publish: boolean | null = null;
  if (published === false && current.isPublished === true) publish = false;
  if (published === true && current.isPublished !== true) {
    const problem = publishProblem({
      title: data.title ?? current.title,
      categories: data.categories ?? current.categories,
      variants: prepared?.variants ?? current.variants,
      moderation: current.moderation,
    });
    if (problem) warn(warnings, first.row, 'Stays a draft: ' + problem.message);
    else publish = true;
  } else if (published === true && current.moderation) {
    warn(warnings, first.row, 'Not published: an admin removed this product.');
  }
  if (context.dryRun) return;

  await applyProductUpdate(context.storeId, id, data, prepared);
  if (publish !== null) {
    // The moderation and demo conditions sit in the write itself, so a takedown landing in between holds.
    await Product.findOneAndUpdate(
      { _id: id, store: context.storeId, deletedAt: null, ...(publish ? { isDemo: { $ne: true }, moderation: null } : {}) },
      { $set: { isPublished: publish } },
    )
      .select('_id')
      .lean();
  }
  await revalidateStoreProduct(context.storeId, id);
}

function refusalOf(err: unknown, firstRow: number): RowProblem {
  if (err instanceof RowProblem) return err;
  if (err instanceof ProductRequestError || err instanceof ProductVariantError) return new RowProblem(firstRow, err.message);
  if (isDuplicateKeyError(err)) return new RowProblem(firstRow, 'A product with this Handle already exists in this store.');
  if (err instanceof HttpError) return new RowProblem(firstRow, err.message);
  throw err;
}

/**
 * Refuses a product whose text a wrong file encoding already damaged (GAP 4), so it is never stored. Every cell is checked
 * for the replacement character and UTF-8 read as Latin-1; Title and Description also for the question marks a plain
 * Excel "CSV" save leaves of Urdu. See looksDamaged.
 */
function assertTextNotDamaged(rows: readonly CsvRow[]): void {
  for (const row of rows) {
    if (row.raw.some((cell) => looksDamaged(cell)) || looksDamaged(row.get('Title'), true) || looksDamaged(row.get('Description'), true)) {
      throw new RowProblem(row.row, DAMAGED_TEXT_MESSAGE);
    }
  }
}

function readRows(text: string): { header: string[]; rows: CsvRow[] } {
  let records: string[][];
  try {
    records = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvFormatError) throw new ProductRequestError(422, 'IMPORT_BAD_FILE', 'This file is not valid CSV: ' + err.message);
    throw err;
  }
  const [header, ...body] = records;
  const names = (header ?? []).map((name) => name.trim().toLowerCase());
  if (!names.includes('handle')) throw new ProductRequestError(422, 'IMPORT_BAD_FILE', 'The first row must be the column names, with a Handle column.');
  if (body.length > PRODUCT_IMPORT_MAX_ROWS) {
    throw new ProductRequestError(422, 'IMPORT_TOO_MANY_ROWS', 'A file can have at most ' + PRODUCT_IMPORT_MAX_ROWS + ' rows. This one has ' + body.length + '.');
  }
  const position = new Map(names.map((name, index) => [name, index]));
  return {
    header: header ?? [],
    rows: body.map((raw, index) => ({
      row: index + 2,
      raw,
      get: (column) => {
        const at = position.get(column.toLowerCase());
        return at === undefined ? '' : restoreCell(raw[at] ?? '').trim();
      },
    })),
  };
}

async function loadContext(storeId: string, dryRun: boolean, groups: Map<string, CsvRow[]>): Promise<ImportContext> {
  const urls = [...groups.values()].flatMap((rows) => rows.flatMap((row) => [...list(row.get('Image URLs')), ...list(row.get('Video URLs'))]));
  const [categoryRows, mediaRows, productRows] = await Promise.all([
    Category.find({ store: storeId }).select('name').lean() as unknown as Promise<Array<{ _id: unknown; name: string }>>,
    (urls.length === 0 ? Promise.resolve([]) : Media.find({ store: storeId, url: { $in: urls } }).select('url resourceType').lean()) as unknown as Promise<
      Array<{ _id: unknown; url: string; resourceType?: string | null }>
    >,
    Product.find({ store: storeId, slug: { $in: [...groups.keys()] } })
      .select('slug title options variants media categories isPublished isDemo moderation deletedAt')
      .lean() as unknown as Promise<ExistingProduct[]>,
  ]);

  const categories = new Map<string, string[]>();
  for (const row of categoryRows) {
    const name = row.name.trim().toLowerCase();
    categories.set(name, [...(categories.get(name) ?? []), String(row._id)]);
  }
  return {
    storeId,
    dryRun,
    categories,
    media: new Map(mediaRows.map((row) => [row.url, { id: String(row._id), isVideo: row.resourceType === 'video' }])),
    existing: new Map(productRows.map((row) => [row.slug, row])),
    fileSkus: new Map(),
  };
}

/**
 * Runs one file. Each Handle stands alone: it is written whole or not at all, and a failed one does not stop the others.
 * A dry run takes every read and check of a real run, and writes nothing.
 */
export async function runProductImport(storeId: string, text: string, dryRun: boolean): Promise<ProductImportReport> {
  const { header, rows } = readRows(text);

  const report: ProductImportRow[] = [];
  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const handle = row.get('Handle').toLowerCase();
    if (handle === '') report.push({ row: row.row, handle: '', status: 'error', message: 'This row has no Handle.', warnings: [] });
    else groups.set(handle, [...(groups.get(handle) ?? []), row]);
  }

  const context = await loadContext(storeId, dryRun, groups);
  let created = 0;
  let updated = 0;
  const failedHandles = new Set<string>();

  for (const [handle, group] of groups) {
    const first = group[0] as CsvRow;
    const warnings: Warnings = new Map();
    try {
      assertTextNotDamaged(group);
      assertFileSkusFree(group, handle, context);
      const current = context.existing.get(handle);
      if (current?.deletedAt) {
        throw new RowProblem(first.row, 'A product in trash holds this Handle. Restore it or delete it for good first.');
      }
      // Any update clears isDemo, as a PATCH does, so a re-imported export would count as an edit and open the way to publishing an
      // unedited sample (D-037). Only the product form makes it the seller's own.
      if (current?.isDemo === true) {
        throw new RowProblem(first.row, 'This is the sample product. Edit it in the product form first.');
      }
      if (current) {
        await updateFromRows(handle, group, current, context, warnings);
        updated += 1;
      } else {
        await createFromRows(handle, group, context, warnings);
        created += 1;
      }
      rememberFileSkus(group, handle, context);
      for (const row of group) report.push({ row: row.row, handle, status: 'ok', message: null, warnings: warnings.get(row.row) ?? [] });
    } catch (err) {
      const problem = refusalOf(err, first.row);
      failedHandles.add(handle);
      for (const row of group) {
        const own = row.row === problem.row;
        report.push({ row: row.row, handle, status: 'error', message: own ? problem.message : 'Not imported: row ' + problem.row + ' of this product failed.', warnings: [] });
      }
    }
  }

  const byRow = new Map(report.map((entry) => [entry.row, entry]));
  const failedRecords = rows.flatMap((row) => {
    const entry = byRow.get(row.row);
    return entry?.status === 'error' ? [[...header.map((_, index) => restoreCell(row.raw[index] ?? '')), entry.message ?? '']] : [];
  });

  return {
    dryRun,
    created,
    updated,
    failed: failedHandles.size + report.filter((entry) => entry.handle === '').length,
    rows: report.sort((a, b) => a.row - b.row),
    failedCsv: failedRecords.length > 0 ? serializeCsv([[...header, 'Error'], ...failedRecords]) : null,
  };
}

interface ExportVariant {
  sku?: string | null;
  price: number;
  compareAtPrice?: number | null;
  stockQuantity: number;
  trackQuantity: boolean;
  optionValues?: string[] | null;
  position?: number | null;
}

interface ExportProduct {
  slug: string;
  title: string;
  description?: string | null;
  categories?: Array<{ name?: string | null } | null> | null;
  isPublished?: boolean | null;
  hideWhenOutOfStock?: boolean | null;
  options?: Array<{ name: string }> | null;
  variants: ExportVariant[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  media?: Array<{ url?: string | null } | null> | null;
  videos?: Array<{ url?: string | null } | null> | null;
}

const urlsOf = (rows: ExportProduct['media']): string => (rows ?? []).flatMap((row) => (row?.url ? [row.url] : [])).join('|');

const flag = (value: boolean | null | undefined): string => (value === true ? 'TRUE' : 'FALSE');

function exportRecords(product: ExportProduct): string[][] {
  const options = product.options ?? [];
  const variants = [...product.variants].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return variants.map((variant, index) => {
    const values = variant.optionValues ?? [];
    const onFirst = (value: string): string => (index === 0 ? value : '');
    const cells: Record<ProductCsvColumn, string> = {
      Handle: product.slug,
      Title: onFirst(product.title),
      Description: onFirst(product.description ?? ''),
      Category: onFirst((product.categories ?? []).flatMap((category) => (category?.name ? [category.name] : [])).join('|')),
      Published: onFirst(flag(product.isPublished)),
      'Option1 Name': onFirst(options[0]?.name ?? ''),
      'Option1 Value': values[0] ?? '',
      'Option2 Name': onFirst(options[1]?.name ?? ''),
      'Option2 Value': values[1] ?? '',
      'Option3 Name': onFirst(options[2]?.name ?? ''),
      'Option3 Value': values[2] ?? '',
      'Variant SKU': variant.sku ?? '',
      'Variant Price': String(variant.price),
      'Variant Compare At Price': variant.compareAtPrice === null || variant.compareAtPrice === undefined ? '' : String(variant.compareAtPrice),
      'Variant Inventory Qty': String(variant.stockQuantity),
      'Track Quantity': flag(variant.trackQuantity),
      'Hide When Out Of Stock': onFirst(flag(product.hideWhenOutOfStock)),
      'SEO Title': onFirst(product.seoTitle ?? ''),
      'SEO Description': onFirst(product.seoDescription ?? ''),
      'Image URLs': onFirst(urlsOf(product.media)),
      'Video URLs': onFirst(urlsOf(product.videos)),
    };
    return PRODUCT_CSV_COLUMNS.map((column) => cells[column]);
  });
}

/** One store's products not in trash, one row per variant. Only the fields below are read: no moderation, no seller data. */
export async function exportProductsCsv(storeId: string): Promise<string> {
  const rows = (await Product.find({ store: storeId, deletedAt: null })
    .select('slug title description categories isPublished hideWhenOutOfStock options variants seoTitle seoDescription media videos')
    .sort({ createdAt: 1, _id: 1 })
    .populate({ path: 'categories', select: 'name' })
    .populate({ path: 'media', select: 'url' })
    .populate({ path: 'videos', select: 'url' })
    .lean()) as unknown as ExportProduct[];
  return serializeCsv([[...PRODUCT_CSV_COLUMNS], ...rows.flatMap(exportRecords)]);
}

/** The columns and one worked example, for the import page's template link. */
export function productCsvTemplate(): string {
  const first: Partial<Record<ProductCsvColumn, string>> = {
    Handle: 'blue-lawn-suit',
    Title: 'Blue Lawn Suit',
    Description: 'Three piece lawn suit.',
    Category: 'Lawn',
    Published: 'FALSE',
    'Option1 Name': 'Size',
    'Option1 Value': 'S',
    'Variant SKU': 'BLS-S',
    'Variant Price': '2500',
    'Variant Inventory Qty': '10',
    'Track Quantity': 'TRUE',
  };
  const second: Partial<Record<ProductCsvColumn, string>> = {
    Handle: 'blue-lawn-suit',
    'Option1 Value': 'M',
    'Variant SKU': 'BLS-M',
    'Variant Price': '2500',
    'Variant Inventory Qty': '5',
    'Track Quantity': 'TRUE',
  };
  return serializeCsv([[...PRODUCT_CSV_COLUMNS], ...[first, second].map((row) => PRODUCT_CSV_COLUMNS.map((column) => row[column] ?? ''))]);
}
