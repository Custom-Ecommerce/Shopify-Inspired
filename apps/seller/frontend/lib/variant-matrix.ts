/*
 * The variant table of the product form, as pure rules. Local to this app, which cannot import @markaz/platform-kit.
 * The limits follow PRODUCT_MAX_OPTIONS and PRODUCT_MAX_VARIANTS in packages/contracts; the server checks them again.
 */

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;
export const MAX_OPTION_VALUES = 50;

/** One option as the form edits it. source is its index in the saved product, or null for a new option. */
export interface OptionDraft {
  key: string;
  name: string;
  values: string[];
  source: number | null;
}

export interface SavedVariant {
  id: string;
  title: string;
  optionValues: string[];
}

export interface MatrixRow {
  /** The variant id, or a key made from the combination for a row not saved yet. */
  key: string;
  id: string | null;
  optionValues: string[];
}

export interface VariantMatrix {
  rows: MatrixRow[];
  /** Saved variants that have no place in the table any more. Saving removes them, with their stock. */
  removed: SavedVariant[];
  count: number;
  tooMany: boolean;
}

/** An option counts once it has a name and a value, so one still being typed does not empty the table. */
export function usableOptions(drafts: readonly OptionDraft[]): OptionDraft[] {
  return drafts.filter((draft) => draft.name.trim() !== "" && draft.values.length > 0);
}

function cartesian(lists: readonly string[][]): string[][] {
  return lists.reduce<string[][]>((combos, values) => combos.flatMap((combo) => values.map((value) => [...combo, value])), [[]]);
}

/**
 * Where a saved variant goes in the new table, or null if its value is gone. An option it never had takes that option's
 * first value: this is how the Default variant lands on the first combination when a product gets its first option, and
 * so keeps its id, SKU and stock. An option removed from the product is simply not read.
 */
function landing(variant: SavedVariant, options: readonly OptionDraft[]): string[] | null {
  const target: string[] = [];
  for (const option of options) {
    const value = option.source === null ? undefined : variant.optionValues[option.source];
    if (value === undefined) target.push(option.values[0] ?? "");
    else if (option.values.includes(value)) target.push(value);
    else return null;
  }
  return target;
}

/**
 * The whole table for these options. Always built from the saved variants, not from the last table, so taking a value out
 * and putting it back restores the variant. When two saved variants land on one combination, the earlier one stays.
 */
export function buildMatrix(drafts: readonly OptionDraft[], saved: readonly SavedVariant[]): VariantMatrix {
  const options = usableOptions(drafts);
  const count = options.reduce((total, option) => total * option.values.length, 1);
  if (count > MAX_VARIANTS) return { rows: [], removed: [], count, tooMany: true };

  const claimed = new Map<string, SavedVariant>();
  const removed: SavedVariant[] = [];
  for (const variant of saved) {
    const target = landing(variant, options);
    const key = JSON.stringify(target);
    if (target === null || claimed.has(key)) removed.push(variant);
    else claimed.set(key, variant);
  }

  const rows = cartesian(options.map((option) => option.values)).map((optionValues) => {
    const key = JSON.stringify(optionValues);
    const variant = claimed.get(key);
    return { key: variant ? variant.id : "new:" + key, id: variant?.id ?? null, optionValues };
  });
  return { rows, removed, count, tooMany: false };
}

/** One row's fields as the form holds them. */
export interface RowValues {
  price: string;
  compareAt: string;
  sku: string;
  barcode: string;
  imageId: string | null;
  trackQuantity: boolean;
  lowStock: string;
  /** Only a new row's initial stock. An existing row's stock changes in Inventory (D-034). */
  stock: string;
}

const isWhole = (value: string): boolean => /^\d+$/.test(value.trim());

/** What is wrong with a row, in words for the seller, or null. */
export function rowProblem(values: RowValues, isNew: boolean): string | null {
  if (!isWhole(values.price)) return "Enter a price in whole rupees.";
  if (values.compareAt.trim() !== "") {
    if (!isWhole(values.compareAt)) return "Enter the compare-at price in whole rupees.";
    if (Number(values.compareAt) <= Number(values.price)) return "The compare-at price must be higher than the price.";
  }
  if (values.lowStock.trim() !== "" && !isWhole(values.lowStock)) return "The low-stock threshold must be a whole number.";
  if (isNew && values.stock.trim() !== "" && !isWhole(values.stock)) return "Initial stock must be a whole number.";
  return null;
}

const optionalNumber = (value: string): number | null => (value.trim() === "" ? null : Number(value));
const optionalText = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * One entry of the whole variants list a save sends (D-036). A saved row goes by its id and never carries stock (D-034);
 * a new row has no id and brings its initial stock. An image no longer in the gallery is dropped from the row.
 */
export function variantPayload(row: MatrixRow, values: RowValues, gallery: ReadonlySet<string>) {
  const fields = {
    optionValues: row.optionValues,
    price: Number(values.price),
    compareAtPrice: optionalNumber(values.compareAt),
    sku: optionalText(values.sku),
    barcode: optionalText(values.barcode),
    imageId: values.imageId !== null && gallery.has(values.imageId) ? values.imageId : null,
    trackQuantity: values.trackQuantity,
    lowStockThreshold: optionalNumber(values.lowStock),
  };
  return row.id !== null ? { id: row.id, ...fields } : { ...fields, stockQuantity: Number(values.stock) || 0 };
}
