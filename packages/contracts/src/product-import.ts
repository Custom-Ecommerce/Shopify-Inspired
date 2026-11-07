/** Bulk import and export of products (US17). The columns are Shopify-style: one product is several rows sharing a Handle. */

export const PRODUCT_IMPORT_MAX_ROWS = 500;
export const PRODUCT_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export const PRODUCT_CSV_COLUMNS = [
  'Handle',
  'Title',
  'Description',
  'Category',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option2 Name',
  'Option2 Value',
  'Option3 Name',
  'Option3 Value',
  'Variant SKU',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Inventory Qty',
  'Track Quantity',
  'Hide When Out Of Stock',
  'SEO Title',
  'SEO Description',
  'Image URLs',
  'Video URLs',
] as const;

export type ProductCsvColumn = (typeof PRODUCT_CSV_COLUMNS)[number];

export interface ProductImportRow {
  /** The row in the file, as a spreadsheet numbers it: the header is row 1. */
  row: number;
  handle: string;
  status: 'ok' | 'error';
  message: string | null;
  warnings: string[];
}

export interface ProductImportReport {
  dryRun: boolean;
  /** Products, not rows. In a dry run: what a real run would do. */
  created: number;
  updated: number;
  failed: number;
  rows: ProductImportRow[];
  /** The rows of the products that failed, with their reason, ready to fix and import again. Null when none failed. */
  failedCsv: string | null;
}
