/*
 * Checks for the variant table's keep and remove rules. This app has no test runner. From the repo root:
 *
 *   pnpm --filter @markaz/platform-kit exec tsx <absolute path to this file>
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { MAX_VARIANTS, buildMatrix, rowProblem, variantPayload } from "./variant-matrix";
import type { OptionDraft, RowValues, SavedVariant } from "./variant-matrix";

const option = (name: string, values: string[], source: number | null): OptionDraft => ({ key: name, name, values, source });
const saved = (id: string, optionValues: string[]): SavedVariant => ({ id, title: optionValues.join(" / ") || "Default", optionValues });

const ids = (drafts: OptionDraft[], variants: SavedVariant[]) => buildMatrix(drafts, variants).rows.map((row) => row.id);

const sized = [saved("s", ["S"]), saved("m", ["M"])];

// The Default variant lands on the first combination, so it keeps its id. The rest are new.
{
  const matrix = buildMatrix([option("Size", ["S", "M"], null)], [saved("default", [])]);
  assert.deepEqual(matrix.rows.map((row) => [row.id, row.optionValues]), [["default", ["S"]], [null, ["M"]]]);
  assert.deepEqual(matrix.removed, []);
}

// A new value only adds rows; everything saved stays where it was.
assert.deepEqual(ids([option("Size", ["S", "M", "L"], 0)], sized), ["s", "m", null]);

// A value taken out marks its variant as removed, and putting it back restores the same variant.
{
  const without = buildMatrix([option("Size", ["S"], 0)], sized);
  assert.deepEqual(without.rows.map((row) => row.id), ["s"]);
  assert.deepEqual(without.removed.map((variant) => variant.id), ["m"]);
  assert.deepEqual(ids([option("Size", ["S", "M"], 0)], sized), ["s", "m"]);
}

// A second option: each saved variant takes its first value, and the other combinations are new.
assert.deepEqual(ids([option("Size", ["S", "M"], 0), option("Colour", ["Red", "Blue"], null)], sized), ["s", null, "m", null]);

// Renaming an option changes nothing, and reordering options keeps each variant on its own values.
{
  const variants = [saved("s-red", ["S", "Red"]), saved("m-blue", ["M", "Blue"])];
  assert.deepEqual(ids([option("Length", ["S", "M"], 0), option("Colour", ["Red", "Blue"], 1)], variants), ["s-red", null, null, "m-blue"]);
  const swapped = buildMatrix([option("Colour", ["Red", "Blue"], 1), option("Size", ["S", "M"], 0)], variants);
  assert.deepEqual(swapped.rows.find((row) => row.id === "m-blue")?.optionValues, ["Blue", "M"]);
  assert.deepEqual(swapped.removed, []);
}

// Removing an option: variants collapse, the earliest stays, and the others are marked.
{
  const variants = [saved("s-red", ["S", "Red"]), saved("s-blue", ["S", "Blue"]), saved("m-red", ["M", "Red"])];
  const matrix = buildMatrix([option("Size", ["S", "M"], 0)], variants);
  assert.deepEqual(matrix.rows.map((row) => row.id), ["s-red", "m-red"]);
  assert.deepEqual(matrix.removed.map((variant) => variant.id), ["s-blue"]);
}

// Removing every option leaves one variant, as the Default.
{
  const matrix = buildMatrix([], sized);
  assert.deepEqual(matrix.rows.map((row) => [row.id, row.optionValues]), [["s", []]]);
  assert.deepEqual(matrix.removed.map((variant) => variant.id), ["m"]);
}

// An option still being typed does not empty the table.
assert.deepEqual(ids([option("Size", ["S", "M"], 0), option("", [], null)], sized), ["s", "m"]);

// The cap: exactly 100 is fine, more builds nothing and removes nothing.
{
  const ten = Array.from({ length: 10 }, (_, index) => "v" + index);
  const full = buildMatrix([option("A", ten, null), option("B", ten, null)], []);
  assert.equal(full.rows.length, MAX_VARIANTS);
  assert.equal(full.tooMany, false);

  const over = buildMatrix([option("A", [...ten, "v10"], null), option("B", ten, null)], sized);
  assert.equal(over.tooMany, true);
  assert.equal(over.count, 110);
  assert.deepEqual(over.rows, []);
  assert.deepEqual(over.removed, []);
}

const values: RowValues = { price: "1000", compareAt: "", sku: " A1 ", barcode: "", imageId: "img", trackQuantity: true, lowStock: "", stock: "5" };

// A saved row goes by id and never carries stock; a new row has no id and brings its stock (D-034, D-036).
{
  const gallery = new Set(["img"]);
  const existing = variantPayload({ key: "s", id: "s", optionValues: ["S"] }, values, gallery);
  assert.equal("stockQuantity" in existing, false);
  assert.equal("id" in existing && existing.id, "s");
  assert.equal(existing.sku, "A1");

  const added = variantPayload({ key: "new:x", id: null, optionValues: ["L"] }, values, gallery);
  assert.equal("id" in added, false);
  assert.equal("stockQuantity" in added && added.stockQuantity, 5);

  // An image taken out of the gallery leaves the row.
  assert.equal(variantPayload({ key: "s", id: "s", optionValues: ["S"] }, values, new Set()).imageId, null);
}

// Whole rupees, and a compare-at above the price.
assert.equal(rowProblem(values, false), null);
assert.match(rowProblem({ ...values, price: "" }, false) ?? "", /whole rupees/);
assert.match(rowProblem({ ...values, price: "10.5" }, false) ?? "", /whole rupees/);
assert.match(rowProblem({ ...values, compareAt: "900" }, false) ?? "", /higher/);
assert.match(rowProblem({ ...values, stock: "-1" }, true) ?? "", /whole number/);

console.log("variant matrix checks passed");
