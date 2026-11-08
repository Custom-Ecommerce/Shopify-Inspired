import { productAvailability } from "@markaz/platform-kit/commerce";
import type { StockStatus } from "../transport/types";

/*
 * Which variant a shopper's choices name, and which choices are left. Pure, and the only place this is decided: a theme
 * draws the result (D-029). Selections are positional, one entry per option, null while that option is not chosen.
 */

export interface ChoosableVariant {
  id: string;
  optionValues: readonly string[];
  availability: StockStatus;
}

export interface ChoosableProduct<V extends ChoosableVariant = ChoosableVariant> {
  options: ReadonlyArray<{ name: string; values: readonly string[] }>;
  variants: readonly V[];
}

export type SelectedOptions = ReadonlyArray<string | null>;

/** available: can be chosen. out_of_stock: the combination exists and cannot be bought. missing: no such combination. */
export type SelectableState = "available" | "out_of_stock" | "missing";

export interface SelectableValue {
  value: string;
  selected: boolean;
  state: SelectableState;
  /** The best availability among the variants this value could still lead to. */
  availability: StockStatus;
}

export interface SelectableOption {
  name: string;
  values: SelectableValue[];
}

/** The variant the choices name. Null until every option is chosen, and for a combination that does not exist. */
export function resolveVariant<V extends ChoosableVariant>(product: ChoosableProduct<V>, selected: SelectedOptions): V | null {
  if (product.options.length === 0) return product.variants[0] ?? null;
  if (!product.options.every((_, index) => Boolean(selected[index]))) return null;
  return product.variants.find((variant) => product.options.every((_, index) => variant.optionValues[index] === selected[index])) ?? null;
}

/** Every value of every option, judged against the choices made on the other options. */
export function selectableOptions(product: ChoosableProduct, selected: SelectedOptions): SelectableOption[] {
  return product.options.map((option, optionIndex) => {
    const others = product.variants.filter((variant) =>
      product.options.every((_, index) => {
        const chosen = selected[index];
        return index === optionIndex || !chosen || variant.optionValues[index] === chosen;
      }),
    );
    return {
      name: option.name,
      values: option.values.map((value) => {
        const reachable = others.filter((variant) => variant.optionValues[optionIndex] === value);
        const availability = reachable.length === 0 ? "out_of_stock" : productAvailability(reachable.map((variant) => variant.availability));
        const state: SelectableState = reachable.length === 0 ? "missing" : availability === "out_of_stock" ? "out_of_stock" : "available";
        return { value, selected: selected[optionIndex] === value, state, availability };
      }),
    };
  });
}

/** Where a shopper starts: a product with one variant is already chosen, and so is an option with one value. */
export function initialSelection(product: ChoosableProduct): Array<string | null> {
  const only = product.variants.length === 1 ? product.variants[0] : undefined;
  return product.options.map((option, index) => only?.optionValues[index] ?? (option.values.length === 1 ? (option.values[0] ?? null) : null));
}

/** Choosing a value, or clearing it by choosing it again. Clearing is how a shopper gets out of a sold-out corner. */
export function toggleOption(selected: SelectedOptions, optionIndex: number, value: string): Array<string | null> {
  return selected.map((current, index) => {
    if (index !== optionIndex) return current;
    return current === value ? null : value;
  });
}
