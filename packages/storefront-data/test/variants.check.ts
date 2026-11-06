/*
 * Checks for the shopper's variant choice: resolveVariant, selectableOptions and the page's view of a selection. No test
 * runner is needed. From the repo root:
 *
 *   pnpm --filter @markaz/platform-kit exec tsx <absolute path to this file>
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { initialSelection, resolveVariant, selectableOptions, toggleOption } from "../src/domain/variants";
import type { StockStatus, StorefrontProductDetail, StorefrontProductVariant } from "../src/transport/types";
import { toProductCardVM } from "../src/view-models/product-card";
import { toProductDetailVM, toVariantSelectionVM } from "../src/view-models/product-detail";

function variant(id: string, optionValues: string[], price: number, availability: StockStatus, imageId: string | null = null): StorefrontProductVariant {
  return { id, title: optionValues.join(" / "), price, compareAtPrice: null, availability, optionValues, imageId };
}

function detail(overrides: Partial<StorefrontProductDetail> = {}): StorefrontProductDetail {
  return {
    id: "p1",
    slug: "kurta",
    title: "Kurta",
    currency: "PKR",
    price: 1000,
    compareAtPrice: null,
    stockStatus: "in_stock",
    defaultVariantId: "s-red",
    hasVariants: true,
    primaryImage: null,
    categories: [],
    avgRating: 0,
    reviewCount: 0,
    options: [
      { name: "Size", values: ["S", "M"] },
      { name: "Colour", values: ["Red", "Blue"] },
    ],
    variants: [
      variant("s-red", ["S", "Red"], 1000, "in_stock", "img-red"),
      variant("s-blue", ["S", "Blue"], 1100, "out_of_stock"),
      variant("m-red", ["M", "Red"], 1200, "low_stock"),
    ],
    description: null,
    highlights: [],
    images: [{ id: "img-red", url: "https://cdn.test/red.jpg", alt: "Red" }],
    seo: { title: null, description: null, imageUrl: null },
    tags: [],
    categorySlugs: [],
    deliveryCharge: 0,
    ...overrides,
  };
}

const product = detail();

// resolveVariant: only a complete choice names a variant, and a combination that does not exist names none.
assert.equal(resolveVariant(product, [null, null]), null);
assert.equal(resolveVariant(product, ["S", null]), null);
assert.equal(resolveVariant(product, ["S", "Blue"])?.id, "s-blue");
assert.equal(resolveVariant(product, ["M", "Blue"]), null);
const noOptions = detail({ options: [], variants: [variant("only", [], 500, "in_stock")] });
assert.equal(resolveVariant(noOptions, [])?.id, "only");

// selectableOptions: each value is judged against the choices on the other options.
{
  const open = selectableOptions(product, [null, null]);
  assert.deepEqual(open.map((option) => option.name), ["Size", "Colour"]);
  assert.deepEqual(open[1]?.values.map((value) => value.state), ["available", "out_of_stock"]);

  const small = selectableOptions(product, ["S", null]);
  assert.equal(small[1]?.values[0]?.state, "available");
  assert.equal(small[1]?.values[1]?.state, "out_of_stock");

  const medium = selectableOptions(product, ["M", null]);
  assert.equal(medium[1]?.values[0]?.availability, "low_stock");
  assert.equal(medium[1]?.values[1]?.state, "missing");

  // The option's own choice does not limit its own values.
  const chosen = selectableOptions(product, ["S", "Red"]);
  assert.equal(chosen[0]?.values[0]?.selected, true);
  assert.equal(chosen[0]?.values[1]?.state, "available");
}

// The starting choice, and clearing a choice.
assert.deepEqual(initialSelection(product), [null, null]);
assert.deepEqual(initialSelection(detail({ options: [{ name: "Size", values: ["S"] }, { name: "Colour", values: ["Red", "Blue"] }] })), ["S", null]);
assert.deepEqual(initialSelection(detail({ variants: [variant("one", ["M", "Blue"], 900, "in_stock")] })), ["M", "Blue"]);
assert.deepEqual(toggleOption(["S", null], 1, "Red"), ["S", "Red"]);
assert.deepEqual(toggleOption(["S", "Red"], 0, "S"), [null, "Red"]);

// The page: price, stock, image and the button follow the choice.
{
  const vm = toProductDetailVM(product);
  assert.equal(vm.priceRange.min.amount, 1000);
  assert.equal(vm.priceRange.max.amount, 1200);
  assert.equal(vm.gallery[0]?.id, "img-red");

  const open = toVariantSelectionVM(vm, [null, null]);
  assert.equal(open.block, "choose_options");
  assert.equal(open.priceFrom, true);
  assert.equal(open.price.amount, 1000);

  const red = toVariantSelectionVM(vm, ["S", "Red"]);
  assert.equal(red.block, null);
  assert.equal(red.variant?.id, "s-red");
  assert.equal(red.imageId, "img-red");
  assert.equal(red.priceFrom, false);

  const low = toVariantSelectionVM(vm, ["M", "Red"]);
  assert.equal(low.price.amount, 1200);
  assert.equal(low.stock.label, "Only a few left");

  assert.equal(toVariantSelectionVM(vm, ["S", "Blue"]).block, "out_of_stock");
  assert.equal(toVariantSelectionVM(vm, ["M", "Blue"]).block, "out_of_stock");

  const single = toProductDetailVM(noOptions);
  assert.equal(toVariantSelectionVM(single, []).block, null);
  assert.equal(toVariantSelectionVM(single, []).variant?.id, "only");

  // A draft or sample product in a preview stays unbuyable, whatever is chosen.
  const draft = toProductDetailVM(detail({ previewLabel: "Draft" }));
  assert.equal(toVariantSelectionVM(draft, ["S", "Red"]).block, "preview_only");
}

// The card: several variants read "from" and open the product page; one variant is as before.
{
  const many = toProductCardVM(product);
  assert.equal(many.priceFrom, true);
  assert.equal(many.canQuickAdd, false);
  const one = toProductCardVM(detail({ hasVariants: false }));
  assert.equal(one.priceFrom, false);
  assert.equal(one.canQuickAdd, true);
}

console.log("variant checks passed");
