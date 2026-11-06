"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { discountPercent } from "@/lib/product-pricing";
import { MAX_OPTIONS, MAX_OPTION_VALUES, MAX_VARIANTS, rowProblem } from "@/lib/variant-matrix";
import type { MatrixRow, OptionDraft, RowValues, VariantMatrix } from "@/lib/variant-matrix";

const cell = "h-8 min-w-20 font-mono text-xs";

function OptionEditor({
  draft,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  draft: OptionDraft;
  index: number;
  count: number;
  onChange: (next: OptionDraft) => void;
  onMove: (target: number) => void;
  onRemove: () => void;
}) {
  const [typed, setTyped] = useState("");

  function addValue() {
    const value = typed.trim();
    if (value === "") return;
    setTyped("");
    const exists = draft.values.some((current) => current.toLowerCase() === value.toLowerCase());
    if (!exists && draft.values.length < MAX_OPTION_VALUES) onChange({ ...draft, values: [...draft.values, value] });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Name of option ${index + 1}`}
          placeholder="Option name, for example Size"
          value={draft.name}
          maxLength={40}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
        <Button type="button" variant="ghost" size="icon" aria-label="Move option up" disabled={index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Move option down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
          <ArrowDown className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Remove option" onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {draft.values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange({ ...draft, values: draft.values.filter((current) => current !== value) })}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Input
          aria-label={`Add a value to option ${index + 1}`}
          placeholder="Add a value, then press Enter"
          className="h-8 max-w-56"
          value={typed}
          maxLength={60}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={addValue}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addValue();
            }
          }}
        />
      </div>
    </div>
  );
}

export interface VariantBuilderProps {
  drafts: OptionDraft[];
  onDraftsChange: (drafts: OptionDraft[]) => void;
  matrix: VariantMatrix;
  valuesOf: (row: MatrixRow) => RowValues;
  onRowsChange: (keys: readonly string[], change: Partial<RowValues>) => void;
  images: ReadonlyArray<{ id: string; url: string }>;
  /** What the saved variants hold, for the read-only stock of an existing row. */
  stockOf: (variantId: string) => { trackQuantity: boolean; stockQuantity: number } | null;
  inventoryHref: string;
  removalConfirmed: boolean;
  onRemovalConfirmed: (confirmed: boolean) => void;
}

/** The Options section, and the Variants table once the product has options. All the rules live in lib/variant-matrix. */
export function VariantBuilder({
  drafts,
  onDraftsChange,
  matrix,
  valuesOf,
  onRowsChange,
  images,
  stockOf,
  inventoryHref,
  removalConfirmed,
  onRemovalConfirmed,
}: VariantBuilderProps) {
  const nextKey = useRef(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkCompareAt, setBulkCompareAt] = useState("");

  function addOption() {
    nextKey.current += 1;
    onDraftsChange([...drafts, { key: `new-${nextKey.current}`, name: "", values: [], source: null }]);
  }

  function moveOption(index: number, target: number) {
    const next = [...drafts];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onDraftsChange(next);
  }

  const rows = matrix.rows;
  const hasTable = drafts.length > 0 && rows.length > 0 && rows[0]?.optionValues.length !== 0;
  const chosen = rows.filter((row) => selected.has(row.key)).map((row) => row.key);
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  function applyBulk(change: Partial<RowValues>) {
    if (chosen.length > 0) onRowsChange(chosen, change);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Label>Options</Label>
          <Button type="button" variant="clay-soft" size="sm" disabled={drafts.length >= MAX_OPTIONS} onClick={addOption}>
            Add option
          </Button>
        </div>
        {drafts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Add an option such as Size or Colour if this product comes in several versions.</p>
        ) : null}
        {drafts.map((draft, index) => (
          <OptionEditor
            key={draft.key}
            draft={draft}
            index={index}
            count={drafts.length}
            onChange={(next) => onDraftsChange(drafts.map((current) => (current.key === draft.key ? next : current)))}
            onMove={(target) => moveOption(index, target)}
            onRemove={() => onDraftsChange(drafts.filter((current) => current.key !== draft.key))}
          />
        ))}
      </div>

      {matrix.tooMany ? (
        <p className="text-sm text-destructive">
          These options make {matrix.count} variants. A product can have at most {MAX_VARIANTS}. Remove some values to continue.
        </p>
      ) : null}

      {matrix.removed.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
          <p className="font-medium">
            {matrix.removed.length === 1 ? "This variant will be removed" : `These ${matrix.removed.length} variants will be removed`}, with
            their stock, when you save:
          </p>
          <ul className="list-disc pl-5 text-xs">
            {matrix.removed.map((variant) => (
              <li key={variant.id}>{variant.title}</li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Checkbox id="confirmRemoval" checked={removalConfirmed} onCheckedChange={(checked) => onRemovalConfirmed(checked === true)} />
            <Label htmlFor="confirmRemoval">Yes, remove {matrix.removed.length === 1 ? "it" : "them"}</Label>
          </div>
        </div>
      ) : null}

      {hasTable ? (
        <div className="flex flex-col gap-3">
          <Label>Variants ({rows.length})</Label>

          {chosen.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{chosen.length} selected</span>
              <Input aria-label="Price for selected variants" placeholder="Price" type="number" min={0} step={1} className="h-8 w-24" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
              <Button type="button" variant="clay-soft" size="sm" disabled={bulkPrice === ""} onClick={() => applyBulk({ price: bulkPrice })}>Set price</Button>
              <Input aria-label="Compare-at price for selected variants" placeholder="Compare-at" type="number" min={0} step={1} className="h-8 w-24" value={bulkCompareAt} onChange={(e) => setBulkCompareAt(e.target.value)} />
              <Button type="button" variant="clay-soft" size="sm" onClick={() => applyBulk({ compareAt: bulkCompareAt })}>Set compare-at</Button>
              <Button type="button" variant="clay-soft" size="sm" onClick={() => applyBulk({ trackQuantity: true })}>Track</Button>
              <Button type="button" variant="clay-soft" size="sm" onClick={() => applyBulk({ trackQuantity: false })}>Do not track</Button>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="p-1">
                    <Checkbox
                      aria-label="Select all variants"
                      checked={allChosen}
                      onCheckedChange={(checked) => setSelected(new Set(checked === true ? rows.map((row) => row.key) : []))}
                    />
                  </th>
                  <th className="p-1">Variant</th>
                  <th className="p-1">Price*</th>
                  <th className="p-1">Compare-at</th>
                  <th className="p-1">SKU</th>
                  <th className="p-1">Barcode</th>
                  <th className="p-1">Image</th>
                  <th className="p-1">Track</th>
                  <th className="p-1">Low at</th>
                  <th className="p-1">Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const values = valuesOf(row);
                  const title = row.optionValues.join(" / ");
                  const problem = rowProblem(values, row.id === null);
                  const percentOff = discountPercent(Number(values.price), values.compareAt === "" ? null : Number(values.compareAt));
                  const saved = row.id === null ? null : stockOf(row.id);
                  const change = (next: Partial<RowValues>) => onRowsChange([row.key], next);
                  return (
                    <tr key={row.key} className="border-t border-border align-top">
                      <td className="p-1">
                        <Checkbox
                          aria-label={`Select ${title}`}
                          checked={selected.has(row.key)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selected);
                            if (checked === true) next.add(row.key);
                            else next.delete(row.key);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="p-1 whitespace-nowrap">
                        <span className="font-medium">{title}</span>
                        {row.id === null ? <span className="ml-1 text-xs text-muted-foreground">New</span> : null}
                        {problem ? <p className="text-xs text-destructive whitespace-normal">{problem}</p> : null}
                        {!problem && percentOff > 0 ? <p className="text-xs text-muted-foreground">{percentOff}% off</p> : null}
                      </td>
                      <td className="p-1">
                        <Input aria-label={`Price of ${title}`} type="number" min={0} step={1} className={cell} value={values.price} onChange={(e) => change({ price: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <Input aria-label={`Compare-at price of ${title}`} type="number" min={0} step={1} className={cell} value={values.compareAt} onChange={(e) => change({ compareAt: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <Input aria-label={`SKU of ${title}`} className={cell} maxLength={64} value={values.sku} onChange={(e) => change({ sku: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <Input aria-label={`Barcode of ${title}`} className={cell} maxLength={64} value={values.barcode} onChange={(e) => change({ barcode: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <select
                          aria-label={`Image of ${title}`}
                          className="h-8 rounded-md border border-input bg-transparent px-1 text-xs"
                          value={images.some((image) => image.id === values.imageId) ? (values.imageId ?? "") : ""}
                          onChange={(e) => change({ imageId: e.target.value === "" ? null : e.target.value })}
                        >
                          <option value="">None</option>
                          {images.map((image, index) => (
                            <option key={image.id} value={image.id}>Image {index + 1}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1">
                        <Checkbox aria-label={`Track quantity of ${title}`} checked={values.trackQuantity} onCheckedChange={(checked) => change({ trackQuantity: checked === true })} />
                      </td>
                      <td className="p-1">
                        <Input aria-label={`Low-stock threshold of ${title}`} type="number" min={0} step={1} className={cell} value={values.lowStock} onChange={(e) => change({ lowStock: e.target.value })} />
                      </td>
                      <td className="p-1 whitespace-nowrap">
                        {row.id === null ? (
                          <Input aria-label={`Initial stock of ${title}`} type="number" min={0} step={1} className={cell} value={values.stock} onChange={(e) => change({ stock: e.target.value })} />
                        ) : (
                          <span className="flex flex-col text-xs">
                            <span className="font-mono">{saved?.trackQuantity ? saved.stockQuantity : "Not tracked"}</span>
                            <Link href={inventoryHref} className="underline underline-offset-4">Adjust in Inventory</Link>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
